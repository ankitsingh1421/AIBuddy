import { LoaderCircle, X } from "lucide-react";

type Provider = "google" | "github";

type AuthDialogProps = {
  open: boolean;
  errorMessage?: string;
  loadingProvider: Provider | null;
  onClose: () => void;
  onLogin: (provider: Provider) => void;
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.76-.07-1.49-.2-2.18H12v4.13h5.38a4.6 4.6 0 0 1-1.99 3.02v2.5h3.22c1.88-1.73 2.99-4.28 2.99-7.47Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.22-2.5c-.9.6-2.04.95-3.4.95-2.61 0-4.82-1.76-5.61-4.12H3.07v2.58A9.99 9.99 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.9A5.98 5.98 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.52H3.07a10 10 0 0 0 0 8.96l3.32-2.58Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.98c1.47 0 2.8.5 3.84 1.5l2.88-2.88C16.96 2.97 14.7 2 12 2a9.99 9.99 0 0 0-8.93 5.52l3.32 2.58c.79-2.36 3-4.12 5.61-4.12Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.6 2 12.25c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.2-3.37-1.2-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.67.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.04 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.72.12 2.52.35 1.9-1.33 2.74-1.05 2.74-1.05.56 1.42.21 2.47.11 2.73.64.71 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.58 5.05.36.32.68.93.68 1.88 0 1.36-.01 2.46-.01 2.8 0 .28.18.61.69.5A10.26 10.26 0 0 0 22 12.25C22 6.6 17.52 2 12 2Z" />
    </svg>
  );
}

export function AuthDialog({
  open,
  errorMessage = "",
  loadingProvider,
  onClose,
  onLogin,
}: AuthDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#1e1c19] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-[#8c8478]">Vectra</p>
            <h2 className="mt-3 text-3xl font-semibold text-[#f4efe8]">Sign in</h2>
            <p className="mt-2 text-sm leading-6 text-[#a89f92]">
              Continue with Google or GitHub. The login opens here from the dashboard and returns to the same page.
            </p>
          </div>
          <button
            className="rounded-full border border-white/10 p-2 text-[#a89f92] transition hover:bg-white/5 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <button
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 text-base text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={() => onLogin("google")}
            disabled={loadingProvider !== null}
            type="button"
          >
            {loadingProvider === "google" ? <LoaderCircle className="size-5 animate-spin" /> : <GoogleIcon />}
            Login with Google
          </button>

          <button
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 text-base text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={() => onLogin("github")}
            disabled={loadingProvider !== null}
            type="button"
          >
            {loadingProvider === "github" ? <LoaderCircle className="size-5 animate-spin" /> : <GitHubIcon />}
            Login with GitHub
          </button>
        </div>

        {errorMessage ? (
          <p className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
