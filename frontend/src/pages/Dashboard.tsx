import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Check,
  ArrowUp,
  Compass,
  Copy,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  LogOut,
  MessageSquarePlus,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AuthDialog } from "@/components/AuthDialog";
import { API_BASE_URL } from "@/lib/api";

type StoredUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  provider: "GOOGLE" | "GITHUB";
};

type ConversationSummary = {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
};

type SourceItem = {
  title: string;
  url: string;
  content: string;
  favicon?: string;
  publishedDate?: string;
};

type ImageItem = {
  url: string;
  description?: string;
};

type AttachmentItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  kind: "image" | "file";
};

type ChatMessage = {
  id: number | string;
  role: "USER" | "ASSISTANT";
  content: string;
  sources?: SourceItem[];
  images?: ImageItem[];
  attachments?: AttachmentItem[];
  followUps?: string[];
  createdAt?: string;
};

type ConversationDetail = {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type TabKey = "answer" | "links" | "images";

const STORAGE_KEY = "vectra_user";
const PENDING_PROMPT_KEY = "vectra_pending_prompt";
const ACTIVE_CONVERSATION_KEY = "vectra_active_conversation";
const LOCAL_CONVERSATIONS_KEY = "vectra_local_conversations";
const GUEST_USAGE_KEY = "vectra_guest_usage_count";
const META_SEPARATOR = "\n__VECTRA_META__";
const GUEST_QUESTION_LIMIT = 5;
const NAV_ITEMS = [
  { label: "Discover", icon: Compass },
  { label: "Finance", icon: Search },
  { label: "Health", icon: Sparkles },
  { label: "Academic", icon: Link2 },
  { label: "Patents", icon: ImageIcon },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const params = useParams();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("answer");
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composerMode, setComposerMode] = useState<"search" | "focus">("search");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "github" | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<number | string | null>(null);
  const [guestUsageCount, setGuestUsageCount] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const routeConversationId = typeof params.conversationId === "string" ? params.conversationId : null;
  const guestLimitReached = !user && guestUsageCount >= GUEST_QUESTION_LIMIT;

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const incomingUser = searchParams.get("user");
    const authError = searchParams.get("authError") || searchParams.get("error");

    if (incomingUser) {
      try {
        const parsedUser = JSON.parse(decodeURIComponent(incomingUser)) as StoredUser;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsedUser));
        setUser(parsedUser);
        setAuthError("");
        setLoadingProvider(null);
        setShowAuthModal(false);

        const pendingPrompt = sessionStorage.getItem(PENDING_PROMPT_KEY);
        window.history.replaceState({}, "", window.location.pathname);
        if (pendingPrompt) {
          sessionStorage.removeItem(PENDING_PROMPT_KEY);
          setPrompt(pendingPrompt);
          queueMicrotask(() => {
            void submitPromptFromAuth(parsedUser, pendingPrompt);
          });
        }
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    if (authError === "db_unavailable") {
      setAuthError("Login failed because PostgreSQL is not running on localhost:5432. Start the database, then try again.");
      setShowAuthModal(true);
      window.history.replaceState({}, "", "/dashboard");
    } else if (authError === "oauth_failed" || authError === "invalid_provider") {
      setAuthError(
        authError === "invalid_provider"
          ? "Unsupported provider requested."
          : "Authentication failed. Check backend env values and OAuth redirect URLs.",
      );
      setShowAuthModal(true);
      window.history.replaceState({}, "", "/dashboard");
    }

    const storedUser = localStorage.getItem(STORAGE_KEY);
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser) as StoredUser);
        setShowAuthModal(false);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    setGuestUsageCount(readGuestUsageCount());
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    void (async () => {
      try {
        const loadedConversations = await refreshConversations(user.id);
        if (cancelled) return;

        const storedConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
        const targetConversationId =
          (routeConversationId && !routeConversationId.startsWith("local-") ? routeConversationId : null) ||
          storedConversationId ||
          null;

        if (targetConversationId) {
          await loadConversation(targetConversationId, user.id);
        } else {
          setActiveConversationId(null);
          setMessages([]);
          setAttachments([]);
          setActiveTab("answer");
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load conversations");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeConversationId, user?.id]);

  useEffect(() => {
    if (user?.id) return;

    const localConversations = getLocalConversations();
    setConversations(
      localConversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        slug: conversation.slug,
        updatedAt: conversation.updatedAt,
      })),
    );

    const storedConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    const targetConversation =
      localConversations.find((conversation) => conversation.id === (routeConversationId || storedConversationId)) || localConversations[0];

    if (targetConversation) {
      setActiveConversationId(targetConversation.id);
      setMessages(targetConversation.messages);
      setActiveTab("answer");
    } else {
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [routeConversationId, user?.id]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, activeTab]);

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "ASSISTANT") || null,
    [messages],
  );

  async function refreshConversations(userId: string) {
    const response = await fetch(`${API_BASE_URL}/conversations?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error("Could not load conversations");
    }

    const data = (await response.json()) as ConversationSummary[];
    setConversations(data);
    return data;
  }

  async function loadConversation(conversationId: string, userIdOverride?: string) {
    const resolvedUserId = userIdOverride || user?.id;
    if (!resolvedUserId || conversationId === activeConversationId) return;

    setLoadingConversationId(conversationId);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/conversation/${conversationId}?userId=${encodeURIComponent(resolvedUserId)}`,
      );

      if (!response.ok) {
        throw new Error("Could not load conversation");
      }

      const data = (await response.json()) as ConversationDetail;
      setActiveConversationId(data.id);
      setMessages(data.messages);
      setAttachments([]);
      setActiveTab("answer");
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, data.id);
      navigate(`/c/${data.id}`, { replace: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load conversation");
    } finally {
      setLoadingConversationId(null);
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setUser(null);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setAttachments([]);
    setAuthError("");
    setShowAuthModal(false);
    navigate("/dashboard", { replace: true });
  }

  function startNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setError("");
    setActiveTab("answer");
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    navigate("/dashboard", { replace: true });
  }

  async function submitPrompt(nextPrompt?: string) {
    const query = (nextPrompt ?? prompt).trim();
    const effectiveQuery = query || (attachments.length ? "Please analyze the attached items." : "");
    if (!effectiveQuery || isSubmitting) return;

    if (!user && guestLimitReached) {
      setAuthError("Guest users can ask only 5 times. Sign in to continue.");
      setShowAuthModal(true);
      return;
    }

    await submitPromptInternal(user, effectiveQuery);
  }

  async function submitPromptFromAuth(authenticatedUser: StoredUser, nextPrompt: string) {
    setUser(authenticatedUser);
    await submitPromptInternal(authenticatedUser, nextPrompt);
  }

  async function submitPromptInternal(currentUser: StoredUser | null, query: string) {
    const currentAttachments = attachments;
    setError("");
    setActiveTab("answer");
    setIsSubmitting(true);
    setPrompt("");
    setAttachments([]);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "USER",
      content: query,
      attachments: currentAttachments,
    };

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "ASSISTANT",
      content: "",
      sources: [],
      images: [],
      followUps: [],
    };

    setMessages((current) => [...current, userMessage, assistantPlaceholder]);

    try {
      const isLocalConversation = !!activeConversationId?.startsWith("local-");
      const endpoint = activeConversationId ? "/vectra_ask/followup" : "/vectra_ask";
      const payload = activeConversationId
        ? {
            userId: !isLocalConversation ? currentUser?.id : undefined,
            query,
            conversationId: !isLocalConversation ? activeConversationId : undefined,
            attachments: currentAttachments,
            history: isLocalConversation
              ? messages.map((message) => ({
                  role: message.role,
                  content: message.content,
                }))
              : undefined,
          }
        : {
            userId: currentUser?.id,
            query,
            attachments: currentAttachments,
          };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error("Could not get response from backend");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = "";
      let answerText = "";
      let metaBuffer = "";
      let metaStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });

        if (!metaStarted) {
          const separatorIndex = streamBuffer.indexOf(META_SEPARATOR);
          if (separatorIndex === -1) {
            answerText += streamBuffer;
            streamBuffer = "";
          } else {
            answerText += streamBuffer.slice(0, separatorIndex);
            metaBuffer += streamBuffer.slice(separatorIndex + META_SEPARATOR.length);
            streamBuffer = "";
            metaStarted = true;
          }
        } else {
          metaBuffer += streamBuffer;
          streamBuffer = "";
        }

        const cleanedAnswer = cleanupStreamedAnswer(answerText);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: cleanedAnswer,
                }
              : message,
          ),
        );
      }

      if (!metaStarted && streamBuffer) {
        answerText += streamBuffer;
      }

      const metadata = metaBuffer ? (JSON.parse(metaBuffer) as ConversationStreamMetadata) : null;
      const finalAnswer = metadata?.answer || cleanupStreamedAnswer(answerText);
      const finalAssistantId = metadata?.messageId ?? assistantMessageId;

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                id: finalAssistantId,
                content: finalAnswer,
                sources: metadata?.sources || [],
                images: metadata?.images || [],
                followUps: metadata?.followUps || [],
              }
            : message,
        ),
      );

      if (metadata?.conversationId) {
        setActiveConversationId(metadata.conversationId);
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, metadata.conversationId);
        navigate(`/c/${metadata.conversationId}`, { replace: true });
      } else {
        const localConversationId = isLocalConversation && activeConversationId ? activeConversationId : `local-${Date.now()}`;
        const localConversation: ConversationDetail = {
          id: localConversationId,
          title: createConversationTitle(query),
          slug: localConversationId,
          updatedAt: new Date().toISOString(),
          messages: [
            ...messages,
            userMessage,
            {
              id: finalAssistantId,
              role: "ASSISTANT",
              content: finalAnswer,
              sources: metadata?.sources || [],
              images: metadata?.images || [],
              followUps: metadata?.followUps || [],
            },
          ],
        };

        saveLocalConversation(localConversation);
        setConversations(
          getLocalConversations().map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            slug: conversation.slug,
            updatedAt: conversation.updatedAt,
          })),
        );
        setActiveConversationId(localConversation.id);
        setMessages(localConversation.messages);
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, localConversation.id);
        navigate(`/c/${localConversation.id}`, { replace: true });
      }

      if (currentUser?.id) {
        try {
          await refreshConversations(currentUser.id);
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : "Could not refresh history");
        }
      } else {
        const nextUsageCount = guestUsageCount + 1;
        localStorage.setItem(GUEST_USAGE_KEY, String(nextUsageCount));
        setGuestUsageCount(nextUsageCount);
      }
    } catch (submitError) {
      setMessages((current) => current.filter((message) => message.id !== assistantMessageId));
      setError(submitError instanceof Error ? submitError.message : "Could not complete request");
    } finally {
      setIsSubmitting(false);
    }
  }

  function login(provider: "google" | "github") {
    setAuthError("");
    setLoadingProvider(provider);
    const redirect = `${window.location.origin}${window.location.pathname}`;
    window.location.href = `${API_BASE_URL}/auth/${provider}?redirect=${encodeURIComponent(redirect)}`;
  }

  async function handleAttachmentSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const nextAttachments = await Promise.all(
      files.map(async (file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        url: file.type.startsWith("image/") ? await fileToDataUrl(file) : undefined,
        kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
      })),
    );

    setAttachments((current) => [...current, ...nextAttachments]);
    event.target.value = "";
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }

  async function copyMessage(messageId: number | string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1600);
    } catch {
      setError("Could not copy the answer");
    }
  }

  const hasConversation = messages.length > 0;
  const initials = (user?.name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="h-screen overflow-hidden bg-[#141311] text-[#f4efe8]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(120,102,73,0.12),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_35%)]" />
      <div className="relative flex h-screen overflow-hidden">
        <AuthDialog
          open={showAuthModal}
          errorMessage={authError}
          loadingProvider={loadingProvider}
          onClose={() => {
            setAuthError("");
            setShowAuthModal(false);
            setLoadingProvider(null);
          }}
          onLogin={login}
        />
        <aside
          className={`${
            sidebarOpen ? "w-[280px]" : "w-[92px]"
          } hidden h-full shrink-0 border-r border-white/6 bg-[#1b1a18]/95 transition-[width] duration-300 lg:flex`}
        >
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white">
                  <Sparkles className="size-4" />
                </div>
                {sidebarOpen ? <span className="text-lg font-medium tracking-wide text-white">vectra</span> : null}
                {sidebarOpen ? <BetaBadge /> : null}  
              </div>
              <button
                className="rounded-xl border border-white/8 bg-white/5 p-2 text-[#b8b1a5] transition hover:text-white"
                onClick={() => setSidebarOpen((current) => !current)}
                type="button"
              >
                <PanelLeft className="size-4" />
              </button>
            </div>

            <div className="px-3">
              <button
                className="flex w-full items-center gap-3 rounded-2xl bg-white/6 px-4 py-3 text-left text-[#f4efe8] transition hover:bg-white/10"
                onClick={startNewChat}
                type="button"
              >
                <MessageSquarePlus className="size-4 shrink-0" />
                {sidebarOpen ? <span className="text-sm">New</span> : null}
              </button>
            </div>

            <div className="mt-6 space-y-1 px-3 text-[#9b9488]">
              <SidebarLink icon={Search} label="Computer" visible={sidebarOpen} />
              <SidebarLink icon={Compass} label="Spaces" visible={sidebarOpen} />
              <SidebarLink icon={Sparkles} label="Artefacts" visible={sidebarOpen} />
              <SidebarLink icon={Link2} label="Customise" visible={sidebarOpen} />
            </div>

            <div className="mt-8 flex items-center gap-3 px-5 text-[#d8d1c5]">
              <History className="size-4" />
              {sidebarOpen ? <span className="text-sm">History</span> : null}
            </div>

            <div className="mt-3 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
              {conversations.length ? conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`w-full rounded-2xl px-3 py-3 text-left transition ${
                    activeConversationId === conversation.id
                      ? "bg-white/10 text-white"
                      : "text-[#a79f92] hover:bg-white/5 hover:text-white"
                  }`}
                  onClick={() => {
                    if (conversation.id.startsWith("local-")) {
                      const localConversation = getLocalConversations().find((item) => item.id === conversation.id);
                      if (!localConversation) return;
                      setActiveConversationId(localConversation.id);
                      setMessages(localConversation.messages);
                      setAttachments([]);
                      setActiveTab("answer");
                      localStorage.setItem(ACTIVE_CONVERSATION_KEY, localConversation.id);
                      navigate(`/c/${localConversation.id}`, { replace: true });
                      return;
                    }

                    void loadConversation(conversation.id);
                  }}
                  type="button"
                >
                  {loadingConversationId === conversation.id ? (
                    <div className="flex items-center gap-2 text-sm">
                      <LoaderCircle className="size-4 animate-spin" />
                      {sidebarOpen ? "Loading..." : ""}
                    </div>
                  ) : sidebarOpen ? (
                    <div>
                      <p className="truncate text-sm">{conversation.title}</p>
                      <p className="mt-1 text-xs text-[#756e64]">{formatTimestamp(conversation.updatedAt)}</p>
                    </div>
                  ) : (
                    <div className="mx-auto size-2 rounded-full bg-current/80" />
                  )}
                </button>
              )) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-[#8f877b]">
                  <p>Ask something to start history here.</p>
                  <button
                    className="mt-3 rounded-full border border-white/10 px-4 py-2 text-xs text-white transition hover:bg-white/8"
                    onClick={() => setShowAuthModal(true)}
                    type="button"
                  >
                    Sign in
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-white/6 p-3">
              <div className="flex items-center justify-between rounded-2xl bg-white/4 px-3 py-3">
                <div className="flex items-center gap-3 overflow-hidden">
                  {user?.image ? (
                    <img src={user.image} alt={user.name} className="size-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-full bg-[#33a8c7] text-sm font-semibold text-[#0b1215]">
                      {initials || "G"}
                    </div>
                  )}
                  {sidebarOpen ? (
                    <div className="min-w-0">
                      {user ? (
                        <>
                          <p className="truncate text-sm text-white">{user.name}</p>
                          <p className="truncate text-xs text-[#91897d]">Signed in</p>
                        </>
                      ) : (
                        <>
                          <p className="truncate text-sm text-white">Sign in</p>
                          <button
                            className="mt-1 rounded-full border border-white/10 px-4 py-2 text-xs text-white transition hover:bg-white/8"
                            onClick={() => setShowAuthModal(true)}
                            type="button"
                          >
                            Open login
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                {sidebarOpen && user ? (
                  <button className="rounded-xl p-2 text-[#b6aea2] transition hover:text-white" onClick={logout} type="button">
                    <LogOut className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-white/6 px-4 py-4 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <nav className="flex items-center gap-2 overflow-x-auto text-sm text-[#a79f92]">
                <TopTab label="Answer" active={activeTab === "answer"} onClick={() => setActiveTab("answer")} icon={Sparkles} />
                <TopTab label="Links" active={activeTab === "links"} onClick={() => setActiveTab("links")} icon={Link2} />
                <TopTab label="Images" active={activeTab === "images"} onClick={() => setActiveTab("images")} icon={ImageIcon} />
              </nav>

              <div className="hidden items-center gap-6 text-sm text-[#8d867b] xl:flex">
                {NAV_ITEMS.map((item) => (
                  <button key={item.label} className="transition hover:text-white" type="button">
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-8 lg:px-10">
              {error ? (
                <div className="mx-auto mb-6 max-w-4xl rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {!hasConversation ? (
                <EmptyState
                  prompt={prompt}
                  setPrompt={setPrompt}
                  isGuestUser={!user}
                  attachments={attachments}
                  fileInputRef={fileInputRef}
                  onAttachmentPick={() => fileInputRef.current?.click()}
                  onAttachmentSelect={(event) => void handleAttachmentSelection(event)}
                  onAttachmentRemove={removeAttachment}
                  onSubmit={() => void submitPrompt()}
                  composerMode={composerMode}
                  setComposerMode={setComposerMode}
                  isSubmitting={isSubmitting}
                  guestLimitReached={guestLimitReached}
                  guestUsageCount={guestUsageCount}
                  onOpenLogin={() => {
                    setAuthError("Guest users can ask only 5 times. Sign in to continue.");
                    setShowAuthModal(true);
                  }}
                />
              ) : activeTab === "answer" ? (
                <div className="mx-auto max-w-4xl space-y-8">
                  {messages.map((message) =>
                    message.role === "USER" ? (
                      <div key={message.id} className="flex justify-end">
                        <div className="max-w-[75%] rounded-[28px] rounded-br-md bg-white/6 px-5 py-4 text-lg text-[#ece4d9] shadow-[0_10px_40px_rgba(0,0,0,0.18)]">
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div key={message.id} className="space-y-5">
                        <AnswerBody
                          content={message.content}
                          pending={isSubmitting && message.id === messages[messages.length - 1]?.id}
                          copied={copiedMessageId === message.id}
                          onCopy={() => void copyMessage(message.id, message.content)}
                        />
                        {!!message.followUps?.length && message.id === latestAssistantMessage?.id ? (
                          <FollowUpsList
                            followUps={message.followUps}
                            onClick={(followUp) => void submitPrompt(followUp)}
                            disabled={isSubmitting}
                          />
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              ) : activeTab === "links" ? (
                <LinksPanel sources={latestAssistantMessage?.sources || []} />
              ) : (
                <ImagesPanel images={latestAssistantMessage?.images || []} />
              )}
            </div>

            {hasConversation ? (
              <div className="shrink-0 border-t border-white/6 bg-[#141311]/95 px-4 py-5 backdrop-blur lg:px-10">
                <div className="mx-auto max-w-4xl">
                  <Composer
                    prompt={prompt}
                    setPrompt={setPrompt}
                    isGuestUser={!user}
                    attachments={attachments}
                    fileInputRef={fileInputRef}
                    onAttachmentPick={() => fileInputRef.current?.click()}
                    onAttachmentSelect={(event) => void handleAttachmentSelection(event)}
                    onAttachmentRemove={removeAttachment}
                    onSubmit={() => void submitPrompt()}
                    composerMode={composerMode}
                    setComposerMode={setComposerMode}
                    isSubmitting={isSubmitting}
                    guestLimitReached={guestLimitReached}
                    guestUsageCount={guestUsageCount}
                    onOpenLogin={() => {
                      setAuthError("Guest users can ask only 5 times. Sign in to continue.");
                      setShowAuthModal(true);
                    }}
                    placeholder="Ask a follow-up"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

type ConversationStreamMetadata = {
  conversationId: string | null;
  messageId: number | null;
  answer: string;
  followUps: string[];
  sources: SourceItem[];
  images: ImageItem[];
};

function SidebarLink({
  icon: Icon,
  label,
  visible,
}: {
  icon: typeof Search;
  label: string;
  visible: boolean;
}) {
  return (
    <button className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-white/5 hover:text-white" type="button">
      <Icon className="size-4 shrink-0" />
      {visible ? <span className="text-sm">{label}</span> : null}
    </button>
  );
}

function TopTab({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: typeof Search;
}) {
  return (
    <button
      className={`inline-flex items-center gap-2 border-b px-2 py-2 text-base transition ${
        active ? "border-white text-white" : "border-transparent text-[#968f83] hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function EmptyState({
  prompt,
  setPrompt,
  isGuestUser,
  attachments,
  fileInputRef,
  onAttachmentPick,
  onAttachmentSelect,
  onAttachmentRemove,
  onSubmit,
  composerMode,
  setComposerMode,
  isSubmitting,
  guestLimitReached,
  guestUsageCount,
  onOpenLogin,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  isGuestUser: boolean;
  attachments: AttachmentItem[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAttachmentPick: () => void;
  onAttachmentSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachmentRemove: (attachmentId: string) => void;
  onSubmit: () => void;
  composerMode: "search" | "focus";
  setComposerMode: (value: "search" | "focus") => void;
  isSubmitting: boolean;
  guestLimitReached: boolean;
  guestUsageCount: number;
  onOpenLogin: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-2 py-10">
      <div className="mb-14 text-center">
        <div className="mb-5 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm uppercase tracking-[0.35em] text-[#8c8478]">
          vectra
        </div>
        <h1 className="text-5xl font-medium tracking-tight text-[#f4efe8] lg:text-7xl">VECTRA AI</h1>
        <div className="mt-5 flex justify-center">
          <BetaBadge />
        </div>
      </div>

      <div className="w-full max-w-3xl space-y-8">
        <Composer
          prompt={prompt}
          setPrompt={setPrompt}
          isGuestUser={isGuestUser}
          attachments={attachments}
          fileInputRef={fileInputRef}
          onAttachmentPick={onAttachmentPick}
          onAttachmentSelect={onAttachmentSelect}
          onAttachmentRemove={onAttachmentRemove}
          onSubmit={onSubmit}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          isSubmitting={isSubmitting}
          guestLimitReached={guestLimitReached}
          guestUsageCount={guestUsageCount}
          onOpenLogin={onOpenLogin}
          placeholder="Type @ for connectors and sources"
        />

        <div className="rounded-[26px] border border-white/7 bg-white/[0.045] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
          <div className="mb-4 flex items-center gap-2 text-lg text-[#beb5a8]">
            <Sparkles className="size-4" />
            Try Computer
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {["reverse linked list", "system design basics", "how transformers work", "best rust resources"].map((item) => (
              <div key={item} className="h-10 rounded-full border border-white/10 bg-[#23211e]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Composer({
  prompt,
  setPrompt,
  isGuestUser,
  attachments,
  fileInputRef,
  onAttachmentPick,
  onAttachmentSelect,
  onAttachmentRemove,
  onSubmit,
  composerMode,
  setComposerMode,
  isSubmitting,
  guestLimitReached,
  guestUsageCount,
  onOpenLogin,
  placeholder,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  isGuestUser: boolean;
  attachments: AttachmentItem[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAttachmentPick: () => void;
  onAttachmentSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachmentRemove: (attachmentId: string) => void;
  onSubmit: () => void;
  composerMode: "search" | "focus";
  setComposerMode: (value: "search" | "focus") => void;
  isSubmitting: boolean;
  guestLimitReached: boolean;
  guestUsageCount: number;
  onOpenLogin: () => void;
  placeholder: string;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-[#1f1d1a]/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,.json"
        onChange={onAttachmentSelect}
      />
      {attachments.length ? (
        <div className="mb-4 flex flex-wrap gap-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              {attachment.kind === "image" && attachment.url ? (
                <img src={attachment.url} alt={attachment.name} className="size-10 rounded-xl object-cover" />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-xl bg-white/8 text-[#d7cfc3]">
                  <FileText className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{attachment.name}</p>
                <p className="text-xs text-[#968f83]">{formatFileSize(attachment.size)}</p>
              </div>
              <button
                className="rounded-full p-1 text-[#968f83] transition hover:bg-white/5 hover:text-white"
                onClick={() => onAttachmentRemove(attachment.id)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        className="min-h-[72px] w-full resize-none border-0 bg-transparent text-xl text-[#f4efe8] outline-none placeholder:text-[#7e776d]"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        value={prompt}
      />
      {isGuestUser && !guestLimitReached ? (
        <p className="mt-3 text-xs text-[#8d867b]">
          Guest usage: {guestUsageCount}/{GUEST_QUESTION_LIMIT}
        </p>
      ) : isGuestUser ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-100">Guest limit reached. Sign in to continue asking.</p>
          <button
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/8"
            onClick={onOpenLogin}
            type="button"
          >
            Sign in
          </button>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-[#a9a193]">
          <button className="rounded-full border border-white/10 p-2 transition hover:bg-white/6" onClick={onAttachmentPick} type="button">
            <Plus className="size-4" />
          </button>
          <button
            className={`rounded-full border px-4 py-2 transition ${
              composerMode === "search" ? "border-white/15 bg-white/8 text-white" : "border-white/8 text-[#9c9589]"
            }`}
            onClick={() => setComposerMode("search")}
            type="button"
          >
            Search
          </button>
          <button
            className={`rounded-full border px-4 py-2 transition ${
              composerMode === "focus" ? "border-white/15 bg-white/8 text-white" : "border-white/8 text-[#9c9589]"
            }`}
            onClick={() => setComposerMode("focus")}
            type="button"
          >
            Focus
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-[#9b9387]">Model</span>
          <button
            className="flex size-12 items-center justify-center rounded-full bg-[#d8d3cd] text-[#181614] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting || (!prompt.trim() && attachments.length === 0) || guestLimitReached}
            onClick={guestLimitReached ? onOpenLogin : onSubmit}
            type="button"
          >
            {isSubmitting ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnswerBody({
  content,
  pending,
  copied,
  onCopy,
}: {
  content: string;
  pending: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const blocks = splitContentBlocks(content);

  return (
    <div className="space-y-5 text-[1.1rem] leading-8 text-[#e7ded2]">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <pre
            key={`${block.type}-${index}`}
            className="overflow-x-auto rounded-[28px] border border-white/6 bg-[#211f1c] px-5 py-4 text-[0.95rem] leading-7 text-[#f2ece4]"
          >
            <code>{block.content}</code>
          </pre>
        ) : (
          <div key={`${block.type}-${index}`} className="space-y-4">
            {block.content
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))}
          </div>
        ),
      )}
      {pending ? <span className="inline-block h-6 w-3 animate-pulse rounded-full bg-[#d5cec3]" /> : null}
      <div className="flex justify-start">
        <button
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-[#cfc7bb] transition hover:bg-white/5 hover:text-white"
          onClick={onCopy}
          type="button"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function FollowUpsList({
  followUps,
  onClick,
  disabled,
}: {
  followUps: string[];
  onClick: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-medium text-[#f2ece4]">Follow-ups</h2>
      <div className="overflow-hidden rounded-[26px] border border-white/7 bg-white/[0.025]">
        {followUps.map((item, index) => (
          <button
            key={`${item}-${index}`}
            className="flex w-full items-center gap-3 border-b border-white/6 px-4 py-5 text-left text-xl text-[#d7cfc3] transition last:border-b-0 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed"
            disabled={disabled}
            onClick={() => onClick(item)}
            type="button"
          >
            <span className="text-[#928a7e]">↳</span>
            <span>{item}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LinksPanel({ sources }: { sources: SourceItem[] }) {
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <p className="text-xl text-[#9c9589]">Search results for the current answer</p>
      {sources.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            {sources.map((source) => {
              const expanded = expandedSources[source.url] || false;
              const description = expanded ? source.content : truncateWords(source.content, 20);

              return (
              <div
                key={source.url}
                className="rounded-[28px] border border-white/6 bg-white/[0.035] p-5 transition hover:bg-white/[0.055]"
              >
                <div className="mb-3 flex items-center gap-3">
                  {source.favicon ? <img src={source.favicon} alt="" className="size-6 rounded-sm" /> : <Link2 className="size-5 text-[#8f877b]" />}
                  <div>
                    <p className="text-sm text-[#d8d0c4]">{getHostname(source.url)}</p>
                    <p className="text-xs text-[#7d766c]">{source.url}</p>
                  </div>
                </div>
                <h3 className="text-2xl text-[#58a6c1]">{source.title}</h3>
                <p className="mt-2 text-lg leading-8 text-[#c7bfb3]">{description}</p>
                <div className="mt-4 flex items-center gap-3">
                  {source.content.split(/\s+/).filter(Boolean).length > 20 ? (
                    <button
                      className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/8"
                      onClick={() =>
                        setExpandedSources((current) => ({
                          ...current,
                          [source.url]: !expanded,
                        }))
                      }
                      type="button"
                    >
                      {expanded ? "Read less" : "Read more"}
                    </button>
                  ) : null}
                  <a
                    className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/8"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open link
                  </a>
                </div>
              </div>
              );
            })}
          </div>
          <div className="space-y-4">
            {sources.slice(0, 4).map((source) => (
              <div key={`${source.url}-preview`} className="overflow-hidden rounded-[28px] border border-white/6 bg-white/[0.03] p-4">
                <div className="flex aspect-square items-center justify-center rounded-[22px] bg-[#f5f1ec] text-[#1a1816]">
                  {source.favicon ? <img src={source.favicon} alt="" className="size-16 rounded-2xl" /> : <Link2 className="size-12" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel label="No links yet. Ask a prompt first." />
      )}
    </div>
  );
}

function ImagesPanel({ images }: { images: ImageItem[] }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <p className="text-xl text-[#9c9589]">Image results for the current answer</p>
      {images.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {images.map((image, index) => (
            <a
              key={`${image.url}-${index}`}
              className="group overflow-hidden rounded-[30px] border border-white/6 bg-white/[0.03]"
              href={image.url}
              rel="noreferrer"
              target="_blank"
            >
              <img src={image.url} alt={image.description || "Search result"} className="h-64 w-full object-cover transition duration-300 group-hover:scale-105" />
              <div className="p-4 text-sm text-[#cfc7bb]">{image.description || "Open image"}</div>
            </a>
          ))}
        </div>
      ) : (
        <EmptyPanel label="No images yet. Ask a prompt first." />
      )}
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.025] px-6 py-12 text-center text-lg text-[#91897d]">
      {label}
    </div>
  );
}

function cleanupStreamedAnswer(text: string) {
  return text
    .replace(/<ANSWER>/g, "")
    .replace(/<\/ANSWER>/g, "")
    .replace(/<FOLLOW_UP>[\s\S]*$/g, "")
    .trimStart();
}

function splitContentBlocks(content: string) {
  const parts = content.split(/```/);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const code = part.replace(/^\w+\n/, "");
        return {
          type: "code" as const,
          content: code.trim(),
        };
      }

      return {
        type: "text" as const,
        content: part.trim(),
      };
    })
    .filter((block) => block.content);
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function truncateWords(value: string, limit: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= limit) {
    return value;
  }

  return `${words.slice(0, limit).join(" ")}...`;
}

function getLocalConversations(): ConversationDetail[] {
  try {
    const raw = localStorage.getItem(LOCAL_CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConversationDetail[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalConversation(conversation: ConversationDetail) {
  const current = getLocalConversations().filter((item) => item.id !== conversation.id);
  const next = [conversation, ...current].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  localStorage.setItem(LOCAL_CONVERSATIONS_KEY, JSON.stringify(next));
}

function createConversationTitle(query: string) {
  const trimmed = query.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function readGuestUsageCount() {
  const value = Number(localStorage.getItem(GUEST_USAGE_KEY) || "0");
  return Number.isFinite(value) ? value : 0;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function BetaBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-white/80 px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-white">
      Beta
    </span>
  );
}
