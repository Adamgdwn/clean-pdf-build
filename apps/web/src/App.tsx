import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { Session } from "@supabase/supabase-js";
import type { DocumentRecord } from "@clean-pdf/domain";

import { apiFetch } from "./lib/api";
import { browserSupabase } from "./lib/supabase";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

type WorkflowDocument = DocumentRecord & {
  currentUserRole: "owner" | "editor" | "signer" | "viewer" | null;
  workflowState: string;
  signable: boolean;
  completionSummary: {
    requiredAssignedFields: number;
    completedRequiredAssignedFields: number;
    remainingRequiredAssignedFields: number;
  };
  editorHistory: {
    currentIndex: number;
    latestIndex: number;
    canUndo: boolean;
    canRedo: boolean;
  };
};

type BillingOverview = {
  billingMode: "live" | "placeholder";
  workspace: {
    id: string;
    name: string;
    slug: string;
    workspaceType: "personal" | "team";
    membershipRole: "owner" | "admin" | "member" | "billing_admin" | null;
    internalMemberCount: number;
  };
  subscription: {
    planKey: string;
    status: string;
    seatCount: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  plans: Array<{
    key: string;
    name: string;
    monthlyPriceUsd: number;
    includedInternalSeats: number;
    includedCompletedDocs: number;
    includedOcrPages: number;
    includedStorageGb: number;
  }>;
};

type SavedSignature = {
  id: string;
  label: string;
  titleText: string | null;
  signatureType: "typed" | "uploaded";
  typedText: string | null;
  storagePath: string | null;
  previewUrl: string | null;
  isDefault: boolean;
  createdAt: string;
};

type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  companyName: string | null;
  jobTitle: string | null;
  locale: string | null;
  timezone: string | null;
  marketingOptIn: boolean;
  productUpdatesOptIn: boolean;
  lastSeenAt: string | null;
};

type DigitalSignatureProfile = {
  id: string;
  label: string;
  titleText: string | null;
  provider: "easy_draft_remote" | "qualified_remote" | "organization_hsm";
  assuranceLevel: string;
  status: "setup_required" | "requested" | "verified" | "rejected";
  certificateFingerprint: string | null;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminOverview = {
  metrics: {
    totalUsers: number;
    totalWorkspaces: number;
    totalDocuments: number;
    sentDocuments: number;
    completedDocuments: number;
    pendingNotifications: number;
    queuedProcessingJobs: number;
    billingCustomers: number;
    estimatedMrrUsd: number;
  };
  recentSubscriptions: Array<{
    id: string;
    workspace_id: string;
    billing_plan_key: string;
    status: string;
    seat_count: number;
    current_period_end: string | null;
    updated_at: string;
  }>;
  recentWorkspaces: Array<{
    id: string;
    name: string;
    slug: string;
    workspace_type: string;
    owner_user_id: string;
    billing_email: string | null;
    created_at: string;
  }>;
};

const documentBucket = import.meta.env.VITE_SUPABASE_DOCUMENT_BUCKET ?? "documents";
const signatureBucket = import.meta.env.VITE_SUPABASE_SIGNATURE_BUCKET ?? "signatures";

function formatState(state: string) {
  return state.replaceAll("_", " ");
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "Not set";
  }

  return new Date(timestamp).toLocaleString();
}

function filenameToTitle(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [documents, setDocuments] = useState<WorkflowDocument[]>([]);
  const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [digitalSignatureProfiles, setDigitalSignatureProfiles] = useState<DigitalSignatureProfile[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isScannedUpload, setIsScannedUpload] = useState(false);
  const [uploadRouting, setUploadRouting] = useState<"sequential" | "parallel">("sequential");
  const [deliveryMode, setDeliveryMode] =
    useState<"self_managed" | "platform_managed">("self_managed");
  const [distributionTarget, setDistributionTarget] = useState("");
  const [notifyOriginatorOnEachSignature, setNotifyOriginatorOnEachSignature] = useState(true);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerOrder, setSignerOrder] = useState("1");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKind, setFieldKind] =
    useState<"signature" | "initial" | "date" | "text">("signature");
  const [fieldPage, setFieldPage] = useState("1");
  const [fieldAssigneeSignerId, setFieldAssigneeSignerId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer" | "signer">("viewer");
  const [savedSignatureLabel, setSavedSignatureLabel] = useState("");
  const [savedSignatureTitle, setSavedSignatureTitle] = useState("");
  const [savedSignatureType, setSavedSignatureType] = useState<"typed" | "uploaded">("typed");
  const [savedSignatureTypedText, setSavedSignatureTypedText] = useState("");
  const [selectedSavedSignatureId, setSelectedSavedSignatureId] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileCompanyName, setProfileCompanyName] = useState("");
  const [profileJobTitle, setProfileJobTitle] = useState("");
  const [profileTimezone, setProfileTimezone] = useState("");
  const [profileLocale, setProfileLocale] = useState("");
  const [profileMarketingOptIn, setProfileMarketingOptIn] = useState(false);
  const [profileProductUpdatesOptIn, setProfileProductUpdatesOptIn] = useState(true);
  const [digitalSignatureLabel, setDigitalSignatureLabel] = useState("");
  const [digitalSignatureTitle, setDigitalSignatureTitle] = useState("");
  const [digitalSignatureProvider, setDigitalSignatureProvider] =
    useState<"easy_draft_remote" | "qualified_remote" | "organization_hsm">("easy_draft_remote");
  const [digitalSignatureAssuranceLevel, setDigitalSignatureAssuranceLevel] = useState("advanced");
  const [nextSignerName, setNextSignerName] = useState("");
  const [nextSignerEmail, setNextSignerEmail] = useState("");
  const [fieldX, setFieldX] = useState("120");
  const [fieldY, setFieldY] = useState("540");
  const [fieldWidth, setFieldWidth] = useState("180");
  const [fieldHeight, setFieldHeight] = useState("40");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBillingRedirecting, setIsBillingRedirecting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragStateRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const selectedSavedSignature =
    savedSignatures.find((signature) => signature.id === selectedSavedSignatureId) ??
    savedSignatures[0] ??
    null;
  const canEdit =
    selectedDocument?.currentUserRole === "owner" || selectedDocument?.currentUserRole === "editor";
  const canManageAccess = selectedDocument?.currentUserRole === "owner";

  async function refreshSession(currentSession: Session | null) {
    setSession(currentSession);

    if (!currentSession) {
      setSessionUser(null);
      setDocuments([]);
      setBillingOverview(null);
      setSavedSignatures([]);
      setAccountProfile(null);
      setDigitalSignatureProfiles([]);
      setAdminOverview(null);
      setSelectedDocumentId(null);
      return;
    }

    const payload = await apiFetch<{ user: SessionUser }>("/session", currentSession);
    setSessionUser(payload.user);
  }

  async function refreshBilling(activeSession: Session) {
    const payload = await apiFetch<BillingOverview>("/billing-overview", activeSession);
    setBillingOverview(payload);
  }

  async function refreshProfile(activeSession: Session) {
    const payload = await apiFetch<{ profile: AccountProfile }>("/profile", activeSession);
    setAccountProfile(payload.profile);
    setProfileDisplayName(payload.profile.displayName);
    setProfileCompanyName(payload.profile.companyName ?? "");
    setProfileJobTitle(payload.profile.jobTitle ?? "");
    setProfileTimezone(payload.profile.timezone ?? "");
    setProfileLocale(payload.profile.locale ?? "");
    setProfileMarketingOptIn(payload.profile.marketingOptIn);
    setProfileProductUpdatesOptIn(payload.profile.productUpdatesOptIn);
  }

  async function refreshSavedSignatures(activeSession: Session) {
    const payload = await apiFetch<{ signatures: SavedSignature[] }>("/saved-signatures", activeSession);
    setSavedSignatures(payload.signatures);
    setSelectedSavedSignatureId((currentValue) => currentValue || payload.signatures[0]?.id || "");
  }

  async function refreshDigitalSignatureProfiles(activeSession: Session) {
    const payload = await apiFetch<{ profiles: DigitalSignatureProfile[] }>(
      "/digital-signatures",
      activeSession,
    );
    setDigitalSignatureProfiles(payload.profiles);
  }

  async function refreshAdminOverview(activeSession: Session) {
    const payload = await apiFetch<AdminOverview>("/admin-overview", activeSession);
    setAdminOverview(payload);
  }

  async function refreshDocuments(activeSession: Session) {
    const payload = await apiFetch<{ documents: WorkflowDocument[] }>("/documents", activeSession);
    setDocuments(payload.documents);
    setSelectedDocumentId((currentId) => currentId ?? payload.documents[0]?.id ?? null);
  }

  async function refreshDocument(documentId: string, activeSession: Session) {
    const payload = await apiFetch<{ document: WorkflowDocument }>(
      `/document?documentId=${encodeURIComponent(documentId)}`,
      activeSession,
    );

    setDocuments((currentDocuments) => {
      const nextDocuments = currentDocuments.filter((document) => document.id !== documentId);
      return [payload.document, ...nextDocuments];
    });
    setSelectedDocumentId(documentId);
  }

  async function loadPreview(documentId: string, activeSession: Session) {
    const payload = await apiFetch<{ signedUrl: string }>(
      `/document-download?documentId=${encodeURIComponent(documentId)}`,
      activeSession,
    );
    setPreviewUrl(payload.signedUrl);
  }

  async function runDocumentAction(path: string, body: Record<string, unknown>) {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch(path, session, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      await loadPreview(selectedDocument.id, session);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyTextToClipboard(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function handleDownloadDocument() {
    if (!previewUrl && !localPreviewUrl) {
      setErrorMessage("Choose or load a document before downloading.");
      return;
    }

    window.open(previewUrl ?? localPreviewUrl ?? undefined, "_blank", "noopener,noreferrer");
  }

  async function handleShareDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ url: string; expiresInSeconds: number }>("/document-share", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      await copyTextToClipboard(payload.url);
      setNoticeMessage(
        `Secure share link copied. It expires in ${Math.round(payload.expiresInSeconds / 3600)} hours.`,
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDuplicateDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ document: WorkflowDocument }>("/document-duplicate", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      await refreshDocuments(session);
      await refreshDocument(payload.document.id, session);
      await loadPreview(payload.document.id, session);
      setNoticeMessage("A saved copy was created in your EasyDraft workspace.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteDocument() {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/document-delete", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });
      setPreviewUrl(null);
      setLocalPreviewUrl(null);
      await refreshDocuments(session);
      setNoticeMessage("Document removed from the active workspace list.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ profile: AccountProfile }>("/profile", session, {
        method: "POST",
        body: JSON.stringify({
          displayName: profileDisplayName,
          companyName: profileCompanyName.trim() || null,
          jobTitle: profileJobTitle.trim() || null,
          timezone: profileTimezone.trim() || null,
          locale: profileLocale.trim() || null,
          marketingOptIn: profileMarketingOptIn,
          productUpdatesOptIn: profileProductUpdatesOptIn,
        }),
      });
      setAccountProfile(payload.profile);
      setNoticeMessage("Account preferences updated.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateDigitalSignatureProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch<{ profile: DigitalSignatureProfile }>("/digital-signatures", session, {
        method: "POST",
        body: JSON.stringify({
          label: digitalSignatureLabel,
          titleText: digitalSignatureTitle.trim() || null,
          provider: digitalSignatureProvider,
          assuranceLevel: digitalSignatureAssuranceLevel,
        }),
      });
      setDigitalSignatureLabel("");
      setDigitalSignatureTitle("");
      await refreshDigitalSignatureProfiles(session);
      setNoticeMessage(
        "Digital-signature profile request saved. Certificate-backed signing still requires provider verification before it can be used on PDFs.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleQuickRoute(routeMode: "sequential" | "parallel") {
    if (!session || !selectedDocument) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      if (selectedDocument.routingStrategy !== routeMode) {
        await apiFetch("/document-routing", session, {
          method: "POST",
          body: JSON.stringify({
            documentId: selectedDocument.id,
            routingStrategy: routeMode,
          }),
        });
      }

      await apiFetch("/document-signers", session, {
        method: "POST",
        body: JSON.stringify({
          documentId: selectedDocument.id,
          name: nextSignerName,
          email: nextSignerEmail,
          required: true,
          signingOrder:
            routeMode === "sequential"
              ? Math.max(
                  0,
                  ...selectedDocument.signers.map((signer) => signer.signingOrder ?? 0),
                ) + 1
              : null,
        }),
      });

      await apiFetch("/document-send", session, {
        method: "POST",
        body: JSON.stringify({ documentId: selectedDocument.id }),
      });

      await refreshDocument(selectedDocument.id, session);
      await refreshDocuments(session);
      setNextSignerName("");
      setNextSignerEmail("");
      setNoticeMessage(
        routeMode === "sequential"
          ? "Next sequential signer added and routing updated."
          : "Parallel signer added and parallel routing updated.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleBillingCheckout(planKey: string) {
    if (!session) {
      return;
    }

    setIsBillingRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-checkout", session, {
        method: "POST",
        body: JSON.stringify({ planKey }),
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsBillingRedirecting(false);
    }
  }

  async function handleBillingPortal() {
    if (!session) {
      return;
    }

    setIsBillingRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-portal", session, {
        method: "POST",
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsBillingRedirecting(false);
    }
  }

  async function handleCreateSavedSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !sessionUser) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      let storagePath: string | null = null;

      if (savedSignatureType === "uploaded") {
        const uploadInput = document.getElementById("saved-signature-upload") as HTMLInputElement | null;
        const file = uploadInput?.files?.[0];

        if (!file) {
          throw new Error("Choose an image file for this saved signature.");
        }

        storagePath = `${sessionUser.id}/saved-signatures/${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await browserSupabase.storage
          .from(signatureBucket)
          .upload(storagePath, file, {
            contentType: file.type || "image/png",
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }
      }

      const payload = await apiFetch<{ signature: SavedSignature }>("/saved-signatures", session, {
        method: "POST",
        body: JSON.stringify({
          label: savedSignatureLabel,
          titleText: savedSignatureTitle.trim() || null,
          signatureType: savedSignatureType,
          typedText: savedSignatureType === "typed" ? savedSignatureTypedText : null,
          storagePath,
          isDefault: savedSignatures.length === 0,
        }),
      });

      setSavedSignatureLabel("");
      setSavedSignatureTitle("");
      setSavedSignatureTypedText("");
      setSelectedSavedSignatureId(payload.signature.id);

      const uploadInput = document.getElementById("saved-signature-upload") as HTMLInputElement | null;
      if (uploadInput) {
        uploadInput.value = "";
      }

      await refreshSavedSignatures(session);
      setNoticeMessage("Saved signature added to your EasyDraft profile.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      if (authMode === "sign_in") {
        const { error } = await browserSupabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }
      } else {
        const { error } = await browserSupabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) {
          throw error;
        }

        setNoticeMessage("Account created. You can sign in immediately because email confirmation is off by default in local Supabase.");
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
    await browserSupabase.auth.signOut();
    setPreviewUrl(null);
    setLocalPreviewUrl(null);
    setUploadName(null);
  }

  async function handleUpload(file: File) {
    if (!session || !sessionUser) {
      setErrorMessage("Sign in before uploading a PDF.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    const documentId = crypto.randomUUID();
    const storagePath = `${sessionUser.id}/${documentId}/${file.name}`;

    try {
      setLocalPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }

        return URL.createObjectURL(file);
      });
      setUploadName(file.name);

      const { error: uploadError } = await browserSupabase.storage
        .from(documentBucket)
        .upload(storagePath, file, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const payload = await apiFetch<{ document: WorkflowDocument }>("/documents", session, {
        method: "POST",
        body: JSON.stringify({
          id: documentId,
          name: filenameToTitle(file.name),
          fileName: file.name,
          storagePath,
          pageCount: null,
          routingStrategy: uploadRouting,
          deliveryMode,
          distributionTarget: distributionTarget.trim() || null,
          notifyOriginatorOnEachSignature,
          isScanned: isScannedUpload,
        }),
      });

      setSelectedDocumentId(payload.document.id);
      await refreshDocuments(session);
      await loadPreview(payload.document.id, session);
      setDistributionTarget("");
      setNoticeMessage("PDF uploaded and document created.");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddSigner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-signers", {
      documentId: selectedDocument.id,
      name: signerName,
      email: signerEmail,
      required: true,
      signingOrder: signerOrder.trim() ? Number(signerOrder) : null,
    });

    setSignerName("");
    setSignerEmail("");
    setSignerOrder(String((selectedDocument.signers.length || 0) + 1));
  }

  async function handleAddField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-fields", {
      documentId: selectedDocument.id,
      page: Number(fieldPage),
      kind: fieldKind,
      label: fieldLabel,
      required: true,
      assigneeSignerId: fieldAssigneeSignerId || null,
      source: "manual",
      x: Number(fieldX),
      y: Number(fieldY),
      width: Number(fieldWidth),
      height: Number(fieldHeight),
    });

    setFieldLabel("");
  }

  async function handleInviteCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    await runDocumentAction("/document-access", {
      documentId: selectedDocument.id,
      email: inviteEmail,
      role: inviteRole,
    });

    setInviteEmail("");
    setInviteRole("viewer");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");
    const billingStatus = params.get("billing");
    const checkoutPlan = params.get("plan");

    if (checkoutStatus === "success") {
      setNoticeMessage("Billing updated. Stripe redirected back successfully.");
    }

    if (checkoutStatus === "cancelled") {
      setNoticeMessage("Checkout was cancelled. Your workspace billing did not change.");
    }

    if (checkoutStatus === "placeholder") {
      setNoticeMessage(
        `Stripe placeholder opened for ${checkoutPlan ?? "the selected"} plan. Add Stripe keys when you are ready to make billing live.`,
      );
    }

    if (billingStatus === "portal_placeholder") {
      setNoticeMessage("Billing portal placeholder opened. Live billing will activate once Stripe is configured.");
    }

    params.delete("checkout");
    params.delete("plan");
    params.delete("billing");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    const authSubscription = browserSupabase.auth.onAuthStateChange((_, nextSession) => {
      refreshSession(nextSession).catch((error) => setErrorMessage((error as Error).message));
    });

    browserSupabase.auth
      .getSession()
      .then(({ data }) => refreshSession(data.session))
      .catch((error) => setErrorMessage((error as Error).message));

    return () => {
      authSubscription.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    Promise.all([
      refreshDocuments(session),
      refreshBilling(session),
      refreshSavedSignatures(session),
      refreshProfile(session),
      refreshDigitalSignatureProfiles(session),
      ...(sessionUser?.isAdmin ? [refreshAdminOverview(session)] : []),
    ]).catch((error) => setErrorMessage((error as Error).message));
  }, [session, sessionUser?.isAdmin]);

  useEffect(() => {
    if (!session || !selectedDocument?.id) {
      return;
    }

    setFieldAssigneeSignerId((currentValue) => currentValue || selectedDocument.signers[0]?.id || "");
    loadPreview(selectedDocument.id, session).catch((error) => setErrorMessage((error as Error).message));
  }, [selectedDocument?.id, session]);

  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get("documentId");

    if (!documentId) {
      return;
    }

    if (documents.some((document) => document.id === documentId)) {
      setSelectedDocumentId(documentId);
    }
  }, [documents]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      const dragState = dragStateRef.current;

      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      if (dragState.mode === "move") {
        setFieldX(String(Math.max(0, Math.round(dragState.originX + deltaX))));
        setFieldY(String(Math.max(0, Math.round(dragState.originY + deltaY))));
        return;
      }

      setFieldWidth(String(Math.max(48, Math.round(dragState.originWidth + deltaX))));
      setFieldHeight(String(Math.max(28, Math.round(dragState.originHeight + deltaY))));
    }

    function handlePointerUp() {
      dragStateRef.current = null;
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">ED</span>
          <div>
            <h1>EasyDraft</h1>
            <p>Private document workflows, reusable signatures, and clean handoffs.</p>
          </div>
        </div>

        <section className="card">
          <p className="eyebrow">Authentication</p>
          {sessionUser ? (
            <div className="stack">
              <p className="muted">
                Signed in as <strong>{sessionUser.name}</strong>
              </p>
              <p className="muted">{sessionUser.email}</p>
              {sessionUser.isAdmin ? <p className="eyebrow">Admin console enabled</p> : null}
              <button className="secondary-button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={handleAuthSubmit}>
              <div className="pill-row">
                <button
                  className={`pill-button ${authMode === "sign_in" ? "active" : ""}`}
                  onClick={() => setAuthMode("sign_in")}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  className={`pill-button ${authMode === "sign_up" ? "active" : ""}`}
                  onClick={() => setAuthMode("sign_up")}
                  type="button"
                >
                  Sign up
                </button>
              </div>
              {authMode === "sign_up" ? (
                <label className="form-field">
                  <span>Full name</span>
                  <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </label>
              ) : null}
              <label className="form-field">
                <span>Email</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Password</span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={isLoading} type="submit">
                {authMode === "sign_in" ? "Continue" : "Create account"}
              </button>
            </form>
          )}
        </section>

        {sessionUser && accountProfile ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Account</p>
              <span>{accountProfile.companyName ?? "Personal"}</span>
            </div>
            <form className="stack form-block account-form" onSubmit={handleSaveProfile}>
              <label className="form-field">
                <span>Display name</span>
                <input
                  required
                  value={profileDisplayName}
                  onChange={(event) => setProfileDisplayName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Company</span>
                <input
                  value={profileCompanyName}
                  onChange={(event) => setProfileCompanyName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Job title</span>
                <input
                  value={profileJobTitle}
                  onChange={(event) => setProfileJobTitle(event.target.value)}
                />
              </label>
              <div className="form-grid compact-grid">
                <label className="form-field">
                  <span>Timezone</span>
                  <input
                    value={profileTimezone}
                    onChange={(event) => setProfileTimezone(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Locale</span>
                  <input
                    value={profileLocale}
                    onChange={(event) => setProfileLocale(event.target.value)}
                  />
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  checked={profileProductUpdatesOptIn}
                  onChange={(event) => setProfileProductUpdatesOptIn(event.target.checked)}
                  type="checkbox"
                />
                <span>Product updates</span>
              </label>
              <label className="checkbox-row">
                <input
                  checked={profileMarketingOptIn}
                  onChange={(event) => setProfileMarketingOptIn(event.target.checked)}
                  type="checkbox"
                />
                <span>Marketing emails</span>
              </label>
              <button className="ghost-button" disabled={isLoading} type="submit">
                Save account
              </button>
            </form>
          </section>
        ) : null}

        {sessionUser ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Signature Library</p>
              <span>{savedSignatures.length}</span>
            </div>
            <div className="stack">
              {savedSignatures.length === 0 ? (
                <p className="muted">Save one or more signatures for different titles, roles, or signing contexts.</p>
              ) : (
                savedSignatures.map((signature) => (
                  <button
                    key={signature.id}
                    className={`document-button ${selectedSavedSignatureId === signature.id ? "active" : ""}`}
                    onClick={() => setSelectedSavedSignatureId(signature.id)}
                    type="button"
                  >
                    <span>{signature.label}</span>
                    <small>
                      {signature.signatureType}
                      {signature.titleText ? ` · ${signature.titleText}` : ""}
                    </small>
                  </button>
                ))
              )}

              {selectedSavedSignature ? (
                <div className="row-card">
                  <div>
                    <strong>{selectedSavedSignature.label}</strong>
                    <p className="muted">
                      {selectedSavedSignature.signatureType === "typed"
                        ? selectedSavedSignature.typedText
                        : "Uploaded signature image"}
                    </p>
                    {selectedSavedSignature.titleText ? (
                      <p className="muted">{selectedSavedSignature.titleText}</p>
                    ) : null}
                  </div>
                  {selectedSavedSignature.previewUrl ? (
                    <img
                      alt={`${selectedSavedSignature.label} preview`}
                      src={selectedSavedSignature.previewUrl}
                      style={{
                        maxHeight: "48px",
                        maxWidth: "120px",
                        objectFit: "contain",
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              <form className="stack form-block" onSubmit={handleCreateSavedSignature}>
                <label className="form-field">
                  <span>Label</span>
                  <input
                    required
                    placeholder="President, Director, Personal"
                    value={savedSignatureLabel}
                    onChange={(event) => setSavedSignatureLabel(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Title text</span>
                  <input
                    placeholder="VP Operations"
                    value={savedSignatureTitle}
                    onChange={(event) => setSavedSignatureTitle(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Signature type</span>
                  <select
                    value={savedSignatureType}
                    onChange={(event) => setSavedSignatureType(event.target.value as "typed" | "uploaded")}
                  >
                    <option value="typed">Typed</option>
                    <option value="uploaded">Uploaded image</option>
                  </select>
                </label>
                {savedSignatureType === "typed" ? (
                  <label className="form-field">
                    <span>Typed signature text</span>
                    <input
                      required
                      placeholder="Adam Goodwin"
                      value={savedSignatureTypedText}
                      onChange={(event) => setSavedSignatureTypedText(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="form-field">
                    <span>Signature image</span>
                    <input
                      id="saved-signature-upload"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      type="file"
                    />
                  </label>
                )}
                <button className="ghost-button" disabled={isLoading} type="submit">
                  Save signature
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {sessionUser ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Digital Signing</p>
              <span>{digitalSignatureProfiles.length}</span>
            </div>
            <div className="stack">
              <p className="muted">
                Reusable e-signatures are live today. Certificate-backed digital signatures are
                modeled here as provider-managed profiles and require verification before they can
                be used to sign PDF bytes securely.
              </p>
              {digitalSignatureProfiles.map((profile) => (
                <div key={profile.id} className="row-card">
                  <div>
                    <strong>{profile.label}</strong>
                    <p className="muted">
                      {profile.provider} · {profile.assuranceLevel}
                    </p>
                  </div>
                  <span>{profile.status}</span>
                </div>
              ))}
              <form className="stack form-block" onSubmit={handleCreateDigitalSignatureProfile}>
                <label className="form-field">
                  <span>Profile label</span>
                  <input
                    required
                    placeholder="Corporate signing cert"
                    value={digitalSignatureLabel}
                    onChange={(event) => setDigitalSignatureLabel(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Title text</span>
                  <input
                    value={digitalSignatureTitle}
                    onChange={(event) => setDigitalSignatureTitle(event.target.value)}
                  />
                </label>
                <div className="form-grid compact-grid">
                  <label className="form-field">
                    <span>Provider</span>
                    <select
                      value={digitalSignatureProvider}
                      onChange={(event) =>
                        setDigitalSignatureProvider(
                          event.target.value as
                            | "easy_draft_remote"
                            | "qualified_remote"
                            | "organization_hsm",
                        )
                      }
                    >
                      <option value="easy_draft_remote">EasyDraft remote</option>
                      <option value="qualified_remote">Qualified remote</option>
                      <option value="organization_hsm">Organization HSM</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Assurance</span>
                    <select
                      value={digitalSignatureAssuranceLevel}
                      onChange={(event) => setDigitalSignatureAssuranceLevel(event.target.value)}
                    >
                      <option value="advanced">Advanced</option>
                      <option value="qualified">Qualified</option>
                    </select>
                  </label>
                </div>
                <button className="ghost-button" disabled={isLoading} type="submit">
                  Request digital signing profile
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {sessionUser && billingOverview ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Billing</p>
              <span>{billingOverview.workspace.workspaceType}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>{billingOverview.workspace.name}</strong>
                  <p className="muted">
                    {billingOverview.subscription
                      ? `${billingOverview.subscription.planKey} · ${billingOverview.subscription.status}`
                      : "No active subscription"}
                  </p>
                </div>
                <span>{billingOverview.workspace.internalMemberCount} seats in workspace</span>
              </div>
              {billingOverview.billingMode === "placeholder" ? (
                <p className="muted">
                  Billing is in placeholder mode. Plan buttons stay clickable, but they loop through
                  a non-live preview until Stripe keys are configured.
                </p>
              ) : null}
              {billingOverview.subscription ? (
                <>
                  <p className="muted">
                    Renewal date: {formatTimestamp(billingOverview.subscription.currentPeriodEnd)}
                  </p>
                  <button
                    className="secondary-button"
                    disabled={isBillingRedirecting}
                    onClick={() => handleBillingPortal().catch((error) => setErrorMessage((error as Error).message))}
                  >
                    Manage billing
                  </button>
                </>
              ) : (
                billingOverview.plans.map((plan) => (
                  <div key={plan.key} className="row-card">
                    <div>
                      <strong>
                        {plan.name} · ${plan.monthlyPriceUsd}/mo
                      </strong>
                      <p className="muted">
                        {plan.includedCompletedDocs} docs · {plan.includedOcrPages} OCR pages ·{" "}
                        {plan.includedStorageGb} GB
                      </p>
                    </div>
                    <button
                      className="ghost-button"
                      disabled={isBillingRedirecting}
                      onClick={() =>
                        handleBillingCheckout(plan.key).catch((error) =>
                          setErrorMessage((error as Error).message),
                        )
                      }
                    >
                      Choose
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}

        {sessionUser?.isAdmin && adminOverview ? (
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Admin</p>
              <span>KPI view</span>
            </div>
            <div className="stack">
              <div className="admin-metrics">
                <div className="metric">
                  <span>Users</span>
                  <strong>{adminOverview.metrics.totalUsers}</strong>
                </div>
                <div className="metric">
                  <span>Workspaces</span>
                  <strong>{adminOverview.metrics.totalWorkspaces}</strong>
                </div>
                <div className="metric">
                  <span>Documents</span>
                  <strong>{adminOverview.metrics.totalDocuments}</strong>
                </div>
                <div className="metric">
                  <span>MRR</span>
                  <strong>${adminOverview.metrics.estimatedMrrUsd}</strong>
                </div>
              </div>
              {adminOverview.recentSubscriptions.slice(0, 3).map((subscription) => (
                <div key={subscription.id} className="row-card">
                  <div>
                    <strong>{subscription.billing_plan_key}</strong>
                    <p className="muted">
                      {subscription.status} · {subscription.seat_count} seats
                    </p>
                  </div>
                  <span>{formatTimestamp(subscription.current_period_end)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="card">
          <div className="section-heading compact">
            <p className="eyebrow">Documents</p>
            <span>{documents.length}</span>
          </div>
          <div className="stack">
            {documents.length === 0 ? (
              <p className="muted">Upload a PDF after signing in to start a workflow.</p>
            ) : (
              documents.map((document) => (
                <button
                  key={document.id}
                  className={`document-button ${document.id === selectedDocument?.id ? "active" : ""}`}
                  onClick={() => setSelectedDocumentId(document.id)}
                >
                  <span>{document.name}</span>
                  <small>
                    {formatState(document.workflowState)} · {document.currentUserRole}
                  </small>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <p className="eyebrow">Deployable workflow</p>
            <h2>EasyDraft keeps document work calm, reusable, and ready to move forward.</h2>
            <p className="hero-copy">
              Private storage, reusable profile signatures, managed routing, and audit-friendly
              workflow state all stay in one place so teams can draft once and move with confidence.
            </p>
          </div>
          <div className="hero-grid">
            <div className="metric">
              <span>Hosting</span>
              <strong>EasyDraft</strong>
            </div>
            <div className="metric">
              <span>Backend core</span>
              <strong>Supabase</strong>
            </div>
            <div className="metric">
              <span>Storage</span>
              <strong>Private bucket</strong>
            </div>
            <div className="metric">
              <span>Distribution</span>
              <strong>Self or managed</strong>
            </div>
          </div>
        </header>

        {errorMessage ? <div className="alert">{errorMessage}</div> : null}
        {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

        <section className="grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Upload and preview</p>
                <h3>Private storage upload with signed preview URLs</h3>
              </div>
              <button
                className="primary-button"
                disabled={!sessionUser || isLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose PDF
              </button>
            </div>

            <div className="form-grid compact-grid">
              <label className="form-field">
                <span>Routing</span>
                <select
                  value={uploadRouting}
                  onChange={(event) =>
                    setUploadRouting(event.target.value as "sequential" | "parallel")
                  }
                >
                  <option value="sequential">Sequential</option>
                  <option value="parallel">Parallel</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  checked={isScannedUpload}
                  onChange={(event) => setIsScannedUpload(event.target.checked)}
                  type="checkbox"
                />
                <span>Scanned PDF</span>
              </label>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>Workflow path</span>
                <select
                  value={deliveryMode}
                  onChange={(event) =>
                    setDeliveryMode(event.target.value as "self_managed" | "platform_managed")
                  }
                >
                  <option value="self_managed">Store, edit, then distribute it myself</option>
                  <option value="platform_managed">Store, edit, and let EasyDraft route signatures</option>
                </select>
              </label>
              {deliveryMode === "self_managed" ? (
                <label className="form-field">
                  <span>Shared storage or distribution target</span>
                  <input
                    placeholder="Dropbox, SharePoint, network folder, email, etc."
                    value={distributionTarget}
                    onChange={(event) => setDistributionTarget(event.target.value)}
                  />
                </label>
              ) : (
                <label className="checkbox-row">
                  <input
                    checked={notifyOriginatorOnEachSignature}
                    onChange={(event) => setNotifyOriginatorOnEachSignature(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Notify the originator after each signature is made</span>
                </label>
              )}
            </div>

            <input
              ref={fileInputRef}
              accept="application/pdf"
              className="visually-hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (!file) {
                  return;
                }

                handleUpload(file).catch((error) => setErrorMessage((error as Error).message));
                event.target.value = "";
              }}
            />

            <div className="preview-frame">
              {previewUrl || localPreviewUrl ? (
                <object data={previewUrl ?? localPreviewUrl ?? undefined} type="application/pdf">
                  <p>Preview unavailable for this browser.</p>
                </object>
              ) : (
                <div className="preview-empty">
                  <strong>Upload a PDF to create the first workflow document.</strong>
                  <p>The file is stored privately in Supabase Storage and previewed through a signed URL.</p>
                </div>
              )}
            </div>

            <p className="muted">{uploadName ? `Last selected file: ${uploadName}` : "No upload yet."}</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Selected workflow</p>
                <h3>{selectedDocument?.name ?? "No document selected"}</h3>
              </div>
              {selectedDocument ? (
                <span className={`status-badge ${selectedDocument.signable ? "open" : "closed"}`}>
                  {selectedDocument.signable ? "Signable" : "Closed to signing"}
                </span>
              ) : null}
            </div>

            {selectedDocument ? (
              <>
                <div className="meta-grid">
                  <div className="meta-item">
                    <span>State</span>
                    <strong>{formatState(selectedDocument.workflowState)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Path</span>
                    <strong>
                      {selectedDocument.deliveryMode === "platform_managed"
                        ? "Managed send + notifications"
                        : "Self-managed distribution"}
                    </strong>
                  </div>
                  <div className="meta-item">
                    <span>Routing</span>
                    <strong>{selectedDocument.routingStrategy}</strong>
                  </div>
                  <div className="meta-item">
                    <span>OCR</span>
                    <strong>{selectedDocument.isOcrComplete ? "Ready" : "Queued or pending"}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Field detection</span>
                    <strong>
                      {selectedDocument.isFieldDetectionComplete ? "Ready" : "Queued or pending"}
                    </strong>
                  </div>
                  <div className="meta-item">
                    <span>Signature security</span>
                    <strong>
                      {digitalSignatureProfiles.some((profile) => profile.status === "verified")
                        ? "Verified digital profile available"
                        : "Standard e-sign active"}
                    </strong>
                  </div>
                </div>

                <div className="completion-card">
                  <p className="eyebrow">Completion logic</p>
                  <h4>
                    {selectedDocument.completionSummary.completedRequiredAssignedFields}/
                    {selectedDocument.completionSummary.requiredAssignedFields} required assigned signing
                    fields complete
                  </h4>
                  <p className="muted">
                    The document remains signable until every required assigned signing field is complete
                    or someone explicitly locks it.
                  </p>
                  <p className="muted">
                    {selectedDocument.deliveryMode === "platform_managed"
                      ? "EasyDraft will queue the next signer email and can notify the originator as signatures complete."
                      : `This file stays in the workspace while you edit it, then you can download or share it${selectedDocument.distributionTarget ? ` through ${selectedDocument.distributionTarget}` : ""}.`}
                  </p>
                </div>

                <div className="toolbar-card">
                  <div className="section-heading compact">
                    <p className="eyebrow">Document actions</p>
                    <span>
                      Undo {selectedDocument.editorHistory.currentIndex}/{selectedDocument.editorHistory.latestIndex}
                    </span>
                  </div>
                  <div className="action-row action-wrap">
                    <button className="secondary-button" disabled={isLoading} onClick={handleDownloadDocument}>
                      Download
                    </button>
                    <button className="secondary-button" disabled={isLoading} onClick={handleDuplicateDocument}>
                      Save as copy
                    </button>
                    <button className="secondary-button" disabled={isLoading} onClick={handleShareDocument}>
                      Share
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading}
                      onClick={() => runDocumentAction("/document-send", { documentId: selectedDocument.id })}
                    >
                      Send for signatures
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading}
                      onClick={() => runDocumentAction("/document-clear", { documentId: selectedDocument.id })}
                    >
                      Clear all
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || !selectedDocument.editorHistory.canUndo}
                      onClick={() => runDocumentAction("/document-undo", { documentId: selectedDocument.id })}
                    >
                      Undo
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isLoading || !selectedDocument.editorHistory.canRedo}
                      onClick={() => runDocumentAction("/document-redo", { documentId: selectedDocument.id })}
                    >
                      Redo
                    </button>
                    <button className="secondary-button danger-button" disabled={isLoading} onClick={handleDeleteDocument}>
                      Delete
                    </button>
                  </div>
                </div>

                {canEdit ? (
                  <div className="toolbar-card">
                    <div className="section-heading compact">
                      <p className="eyebrow">Next step</p>
                      <span>{selectedDocument.routingStrategy}</span>
                    </div>
                    <div className="form-grid compact-grid">
                      <label className="form-field">
                        <span>Next signer name</span>
                        <input
                          value={nextSignerName}
                          onChange={(event) => setNextSignerName(event.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>Next signer email</span>
                        <input
                          type="email"
                          value={nextSignerEmail}
                          onChange={(event) => setNextSignerEmail(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="action-row action-wrap">
                      <button
                        className="secondary-button"
                        disabled={isLoading || !nextSignerName.trim() || !nextSignerEmail.trim()}
                        onClick={() => handleQuickRoute("sequential").catch((error) => setErrorMessage((error as Error).message))}
                      >
                        Queue next signature
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isLoading || !nextSignerName.trim() || !nextSignerEmail.trim()}
                        onClick={() => handleQuickRoute("parallel").catch((error) => setErrorMessage((error as Error).message))}
                      >
                        Add parallel signer
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="action-row action-wrap">
                  {canEdit ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={isLoading}
                        onClick={() =>
                          runDocumentAction("/document-processing", {
                            documentId: selectedDocument.id,
                            jobType: "ocr",
                          })
                        }
                      >
                        Queue OCR
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isLoading}
                        onClick={() =>
                          runDocumentAction("/document-processing", {
                            documentId: selectedDocument.id,
                            jobType: "field_detection",
                          })
                        }
                      >
                        Detect fields
                      </button>
                    </>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={isLoading}
                    onClick={() => runDocumentAction("/document-lock", { documentId: selectedDocument.id })}
                  >
                    Lock document
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isLoading}
                    onClick={() =>
                      runDocumentAction("/document-reopen", { documentId: selectedDocument.id })
                    }
                  >
                    Reopen document
                  </button>
                </div>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Signers</p>
                      <span>{selectedDocument.signers.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.signers.map((signer) => (
                        <div key={signer.id} className="row-card">
                          <div>
                            <strong>{signer.name}</strong>
                            <p className="muted">
                              {signer.email}
                              {signer.signingOrder ? ` · order ${signer.signingOrder}` : " · any order"}
                            </p>
                          </div>
                          <span>{signer.required ? "Required" : "Optional"}</span>
                        </div>
                      ))}
                    </div>

                    {canEdit ? (
                      <form className="stack form-block" onSubmit={handleAddSigner}>
                        <label className="form-field">
                          <span>Name</span>
                          <input
                            required
                            value={signerName}
                            onChange={(event) => setSignerName(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>Email</span>
                          <input
                            required
                            type="email"
                            value={signerEmail}
                            onChange={(event) => setSignerEmail(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>Signing order</span>
                          <input
                            value={signerOrder}
                            onChange={(event) => setSignerOrder(event.target.value)}
                          />
                        </label>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Add signer
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Fields</p>
                      <span>{selectedDocument.fields.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.fields.map((field) => (
                        <div key={field.id} className="row-card">
                          <div>
                            <strong>
                              {field.label} · {field.kind}
                            </strong>
                            <p className="muted">
                              Page {field.page} · {field.source} ·{" "}
                              {field.assigneeSignerId ?? "unassigned"}
                            </p>
                            {field.appliedSavedSignatureId ? (
                              <p className="muted">
                                Saved signature:{" "}
                                {savedSignatures.find(
                                  (signature) => signature.id === field.appliedSavedSignatureId,
                                )?.label ?? "Applied"}
                              </p>
                            ) : null}
                          </div>
                          <div className="field-actions">
                            <span>{field.completedAt ? "Complete" : "Open"}</span>
                            {!field.completedAt &&
                            (field.kind === "signature" || field.kind === "initial") &&
                            selectedSavedSignature ? (
                              <small className="muted">
                                Uses {selectedSavedSignature.label}
                                {selectedSavedSignature.titleText
                                  ? ` · ${selectedSavedSignature.titleText}`
                                  : ""}
                              </small>
                            ) : null}
                            {!field.completedAt ? (
                              <button
                                className="ghost-button"
                                disabled={isLoading}
                                onClick={() =>
                                  runDocumentAction("/document-field-complete", {
                                    documentId: selectedDocument.id,
                                    fieldId: field.id,
                                    savedSignatureId:
                                      field.kind === "signature" || field.kind === "initial"
                                        ? selectedSavedSignatureId || null
                                        : null,
                                  })
                                }
                              >
                                Complete field
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {canEdit ? (
                      <form className="stack form-block" onSubmit={handleAddField}>
                        <label className="form-field">
                          <span>Field label</span>
                          <input
                            required
                            value={fieldLabel}
                            onChange={(event) => setFieldLabel(event.target.value)}
                          />
                        </label>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>Kind</span>
                            <select
                              value={fieldKind}
                              onChange={(event) =>
                                setFieldKind(
                                  event.target.value as "signature" | "initial" | "date" | "text",
                                )
                              }
                            >
                              <option value="signature">Signature</option>
                              <option value="initial">Initial</option>
                              <option value="date">Date</option>
                              <option value="text">Text</option>
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Page</span>
                            <input
                              required
                              value={fieldPage}
                              onChange={(event) => setFieldPage(event.target.value)}
                            />
                          </label>
                        </div>
                        <label className="form-field">
                          <span>Assign to signer</span>
                          <select
                            value={fieldAssigneeSignerId}
                            onChange={(event) => setFieldAssigneeSignerId(event.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {selectedDocument.signers.map((signer) => (
                              <option key={signer.id} value={signer.id}>
                                {signer.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="form-grid compact-grid">
                          <label className="form-field">
                            <span>X</span>
                            <input
                              required
                              value={fieldX}
                              onChange={(event) => setFieldX(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Y</span>
                            <input
                              required
                              value={fieldY}
                              onChange={(event) => setFieldY(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Width</span>
                            <input
                              required
                              value={fieldWidth}
                              onChange={(event) => setFieldWidth(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>Height</span>
                            <input
                              required
                              value={fieldHeight}
                              onChange={(event) => setFieldHeight(event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="field-canvas">
                          <div className="field-canvas-label">Drag to place or resize the next field box</div>
                          {selectedDocument.fields.map((field) => (
                            <div
                              key={field.id}
                              className="field-canvas-box field-canvas-box-existing"
                              style={{
                                left: `${field.x}px`,
                                top: `${field.y}px`,
                                width: `${field.width}px`,
                                height: `${field.height}px`,
                              }}
                            >
                              {field.label}
                            </div>
                          ))}
                          <div
                            className="field-canvas-box"
                            onMouseDown={(event) => {
                              dragStateRef.current = {
                                mode: "move",
                                startX: event.clientX,
                                startY: event.clientY,
                                originX: Number(fieldX),
                                originY: Number(fieldY),
                                originWidth: Number(fieldWidth),
                                originHeight: Number(fieldHeight),
                              };
                            }}
                            style={{
                              left: `${Number(fieldX)}px`,
                              top: `${Number(fieldY)}px`,
                              width: `${Number(fieldWidth)}px`,
                              height: `${Number(fieldHeight)}px`,
                            }}
                          >
                            <span>{fieldLabel || "New field"}</span>
                            <button
                              className="field-canvas-handle"
                              onMouseDown={(event) => {
                                event.stopPropagation();
                                dragStateRef.current = {
                                  mode: "resize",
                                  startX: event.clientX,
                                  startY: event.clientY,
                                  originX: Number(fieldX),
                                  originY: Number(fieldY),
                                  originWidth: Number(fieldWidth),
                                  originHeight: Number(fieldHeight),
                                };
                              }}
                              type="button"
                            />
                          </div>
                        </div>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Add field
                        </button>
                      </form>
                    ) : null}
                  </div>
                </section>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Access</p>
                      <span>{selectedDocument.access.length} roles</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.access.map((entry) => (
                        <div key={`${entry.userId}-${entry.role}`} className="row-card">
                          <strong>{entry.userId}</strong>
                          <span>{entry.role}</span>
                        </div>
                      ))}
                    </div>

                    {canManageAccess ? (
                      <form className="stack form-block" onSubmit={handleInviteCollaborator}>
                        <label className="form-field">
                          <span>Invite email</span>
                          <input
                            required
                            type="email"
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          <span>Role</span>
                          <select
                            value={inviteRole}
                            onChange={(event) =>
                              setInviteRole(event.target.value as "editor" | "viewer" | "signer")
                            }
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            <option value="signer">Signer</option>
                          </select>
                        </label>
                        <button className="ghost-button" disabled={isLoading} type="submit">
                          Invite collaborator
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Audit trail</p>
                      <span>{selectedDocument.auditTrail.length} events</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.auditTrail.slice(0, 8).map((event) => (
                        <div key={event.id} className="timeline-item">
                          <strong>{event.summary}</strong>
                          <p className="muted">
                            {event.type} · {formatTimestamp(event.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="subpanel split">
                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Version history</p>
                      <span>{selectedDocument.versions.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.versions.map((version) => (
                        <div key={version.id} className="timeline-item">
                          <strong>{version.label}</strong>
                          <p className="muted">
                            {version.note} · {formatTimestamp(version.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Notifications</p>
                      <span>{selectedDocument.notifications.length}</span>
                    </div>
                    <div className="stack">
                      {selectedDocument.notifications.length === 0 ? (
                        <p className="muted">
                          {selectedDocument.deliveryMode === "platform_managed"
                            ? "Notifications will appear here once the document is sent or signatures are completed."
                            : "Self-managed documents do not queue automatic signature emails."}
                        </p>
                      ) : (
                        selectedDocument.notifications.slice(0, 8).map((notification) => (
                          <div key={notification.id} className="timeline-item">
                            <strong>
                              {notification.eventType.replaceAll("_", " ")} · {notification.status}
                            </strong>
                            <p className="muted">
                              {notification.recipientEmail} · {formatTimestamp(notification.queuedAt)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="section-heading">
                      <p className="eyebrow">Lock metadata</p>
                      <span>{selectedDocument.lockedAt ? "Explicitly locked" : "Open"}</span>
                    </div>
                    <div className="meta-grid">
                      <div className="meta-item">
                        <span>Locked at</span>
                        <strong>{formatTimestamp(selectedDocument.lockedAt)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Locked by</span>
                        <strong>{selectedDocument.lockedByUserId ?? "Not locked"}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Reopened at</span>
                        <strong>{formatTimestamp(selectedDocument.reopenedAt)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Your role</span>
                        <strong>{selectedDocument.currentUserRole ?? "none"}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Distribution target</span>
                        <strong>{selectedDocument.distributionTarget ?? "Managed in app"}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Originator updates</span>
                        <strong>
                          {selectedDocument.notifyOriginatorOnEachSignature ? "Enabled" : "Off"}
                        </strong>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <p className="muted">Sign in and upload a document to start.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
