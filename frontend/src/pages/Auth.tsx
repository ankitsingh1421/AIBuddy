import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AuthDialog } from "@/components/AuthDialog";
import { API_BASE_URL } from "@/lib/api";

type Provider = "google" | "github";

const STORAGE_KEY = "vectra_user";

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);

  const errorMessage = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get("error");

    if (!error) return "";
    if (error === "oauth_failed") return "Authentication failed. Check backend env values and OAuth redirect URLs.";
    if (error === "db_unavailable") return "Database is not reachable. Start PostgreSQL and try logging in again.";
    if (error === "invalid_provider") return "Unsupported provider requested.";
    return "Authentication could not be completed.";
  }, [location.search]);

  useEffect(() => {
    const storedUser = localStorage.getItem(STORAGE_KEY);
    if (storedUser) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  function login(provider: Provider) {
    setLoadingProvider(provider);
    const redirect = `${window.location.origin}/dashboard`;
    window.location.href = `${API_BASE_URL}/auth/${provider}?redirect=${encodeURIComponent(redirect)}`;
  }

  return (
    <AuthDialog open errorMessage={errorMessage} loadingProvider={loadingProvider} onClose={() => navigate("/dashboard", { replace: true })} onLogin={login} />
  );
}
