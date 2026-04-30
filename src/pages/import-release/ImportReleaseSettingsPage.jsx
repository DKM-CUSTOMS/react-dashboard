import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Bold,
  CheckCircle2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Monitor,
  Redo2,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Underline,
  Undo2,
  Variable,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  getImportReleaseHealth,
  getImportReleaseRuns,
  getImportReleaseSettings,
  IRP_SETUP_STREAM_URL,
  refreshIrpSession,
  sendImportReleaseTestEmail,
  sendIrpSetupInput,
  startIrpSetupSession,
  stopIrpSetupSession,
  updateImportReleaseSettings,
} from '../../api/importReleaseApi';

const SAMPLE_VALUES = {
  declaration_id: '257979',
  container_number: 'MEDU2900426',
  eta: '2026-05-06',
  bl: '2166031770',
  eori_ship_agent: 'BE0464255361',
  crn: 'CRN123456789',
  mrn: '26BE000000000001',
  tsd_status: 'RELEASED',
  clearance_status: 'CLEARED',
};

const renderTemplate = (template, variables) => String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
  return String(variables[key] ?? '');
});

const emptyForm = {
  email: {
    to: '',
    cc: '',
    subject_template: '',
    body_html: '',
    signature_content_html: '',
  },
};

const editorButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:border-[#714B67] hover:text-[#714B67]';

const RichTextEditor = forwardRef(function RichTextEditor({ label, value, onChange, placeholder, onFocus }, ref) {
  const editorRef = useRef(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if ((el.innerHTML || '') !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const emitChange = () => {
    const html = editorRef.current?.innerHTML || '';
    onChange(html === '<br>' ? '' : html);
  };

  const runCommand = (command, commandValue = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    emitChange();
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertToken: (token) => {
      editorRef.current?.focus();
      document.execCommand('insertText', false, token);
      emitChange();
    },
  }));

  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="overflow-hidden rounded-md border border-gray-300 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <button type="button" className={editorButtonClass} title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('bold')}><Bold size={14} /></button>
          <button type="button" className={editorButtonClass} title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('italic')}><Italic size={14} /></button>
          <button type="button" className={editorButtonClass} title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('underline')}><Underline size={14} /></button>
          <button type="button" className={editorButtonClass} title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertUnorderedList')}><List size={14} /></button>
          <button type="button" className={editorButtonClass} title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('insertOrderedList')}><ListOrdered size={14} /></button>
          <button
            type="button"
            className={editorButtonClass}
            title="Insert link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = window.prompt('Enter the link URL');
              if (url) runCommand('createLink', url);
            }}
          >
            <Link2 size={14} />
          </button>
          <button type="button" className={editorButtonClass} title="Undo" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('undo')}><Undo2 size={14} /></button>
          <button type="button" className={editorButtonClass} title="Redo" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('redo')}><Redo2 size={14} /></button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={onFocus}
          onInput={emitChange}
          className="min-h-[220px] px-3 py-3 text-sm text-gray-900 focus:outline-none"
          data-placeholder={placeholder}
          style={{ whiteSpace: 'normal' }}
        />
      </div>
    </label>
  );
});

// =============================================================================
// IRP Connection Tab — embedded remote browser for setup + live status
// =============================================================================

const STATUS_STYLES = {
  connected:    'border-green-200 bg-green-50 text-green-800',
  refreshing:   'border-amber-200 bg-amber-50 text-amber-800',
  setup_active: 'border-blue-200 bg-blue-50 text-blue-800',
  needs_setup:  'border-red-200 bg-red-50 text-red-800',
  unknown:      'border-gray-200 bg-gray-50 text-gray-700',
};

function IrpConnectionTab({ health, onRefreshHealth, irpRefreshMutation, irpSetupStartMutation, irpSetupStopMutation }) {
  const session = health?.irpSession || {};
  const isSetupActive = session.status === 'setup_active';
  const isConnected = session.status === 'connected';
  const imgRef = useRef(null);
  const [screenshot, setScreenshot] = useState(null);
  const [streamConnected, setStreamConnected] = useState(false);

  // SSE screenshot stream — only active while setup is running
  useEffect(() => {
    if (!isSetupActive) { setScreenshot(null); setStreamConnected(false); return; }
    const es = new EventSource(IRP_SETUP_STREAM_URL);
    es.onopen = () => setStreamConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.screenshot) setScreenshot(data.screenshot);
        if (data.state?.status !== 'setup_active') {
          es.close();
          onRefreshHealth();
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => setStreamConnected(false);
    return () => es.close();
  }, [isSetupActive, onRefreshHealth]);

  // Forward click events to the remote browser
  const handleBrowserClick = useCallback(async (e) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (1280 / rect.width));
    const y = Math.round((e.clientY - rect.top) * (800 / rect.height));
    await sendIrpSetupInput({ type: 'click', x, y });
  }, []);

  // Forward keyboard events to the remote browser
  const [inputValue, setInputValue] = useState('');
  const handleInputKey = useCallback(async (e) => {
    if (e.key === 'Enter') {
      await sendIrpSetupInput({ type: 'key', key: 'Enter' });
      setInputValue('');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      await sendIrpSetupInput({ type: 'key', key: 'Tab' });
    } else if (e.key === 'Backspace') {
      await sendIrpSetupInput({ type: 'key', key: 'Backspace' });
    }
  }, []);
  const handleInputChange = useCallback(async (e) => {
    const lastChar = e.target.value.slice(-1);
    setInputValue(e.target.value);
    if (lastChar) await sendIrpSetupInput({ type: 'type', text: lastChar });
  }, []);

  const statusStyle = STATUS_STYLES[session.status] || STATUS_STYLES.unknown;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`rounded-lg border px-5 py-4 ${statusStyle}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isConnected
              ? <Wifi size={20} />
              : session.status === 'needs_setup'
                ? <WifiOff size={20} />
                : <RefreshCw size={20} className={session.status === 'refreshing' ? 'animate-spin' : ''} />}
            <div>
              <div className="font-semibold capitalize">{session.status?.replace(/_/g, ' ') || 'Unknown'}</div>
              <div className="text-sm opacity-80">{health?.irpAuthDetail || '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isSetupActive && (
              <button
                type="button"
                onClick={() => irpRefreshMutation.mutate()}
                disabled={irpRefreshMutation.isPending || session.status === 'refreshing'}
                className="inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-medium hover:bg-white/80 disabled:opacity-50"
              >
                <RefreshCw size={12} className={irpRefreshMutation.isPending ? 'animate-spin' : ''} />
                Refresh Token
              </button>
            )}
            {!isSetupActive && (
              <button
                type="button"
                onClick={() => irpSetupStartMutation.mutate()}
                disabled={irpSetupStartMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#714B67] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5a3c52] disabled:opacity-50"
              >
                <Monitor size={12} />
                {isConnected ? 'Re-authenticate' : 'Connect to IRP'}
              </button>
            )}
            {isSetupActive && (
              <button
                type="button"
                onClick={() => irpSetupStopMutation.mutate()}
                disabled={irpSetupStopMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-medium hover:bg-white/80"
              >
                <X size={12} />
                Cancel
              </button>
            )}
          </div>
        </div>
        {session.tokenExpiresAt && (
          <div className="mt-2 text-xs opacity-70">
            Token expires: {new Date(session.tokenExpiresAt).toLocaleString()}
            {session.lastRefreshedAt && ` · Last refreshed: ${new Date(session.lastRefreshedAt).toLocaleString()}`}
          </div>
        )}
        {session.lastError && (
          <div className="mt-2 text-xs font-medium opacity-80">{session.lastError}</div>
        )}
      </div>

      {/* Remote browser view — only shown during setup */}
      {isSetupActive && (
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-gray-700">
            <div className="flex items-center gap-2">
              <Monitor size={14} />
              <span className="font-medium">IRP Login Browser</span>
              {streamConnected
                ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Live</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Connecting…</span>}
            </div>
            <span className="text-xs text-gray-400">Click inside the browser view to interact</span>
          </div>

          {/* Screenshot canvas */}
          <div className="relative bg-gray-900">
            {screenshot
              ? (
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${screenshot}`}
                  alt="IRP browser"
                  className="block w-full cursor-pointer"
                  onClick={handleBrowserClick}
                  draggable={false}
                />
              )
              : (
                <div className="flex h-64 items-center justify-center text-gray-500 text-sm">
                  <RefreshCw size={16} className="mr-2 animate-spin" />
                  Loading browser…
                </div>
              )}
          </div>

          {/* Keyboard input relay */}
          <div className="border-t bg-gray-50 px-4 py-3">
            <div className="text-xs text-gray-500 mb-1.5">Type here to send keystrokes to the browser:</div>
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKey}
              placeholder="Click the browser above or type here…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]"
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {/* Info when not in setup */}
      {!isSetupActive && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600 space-y-2">
          <div className="font-medium text-gray-800">How it works</div>
          <p>The dashboard uses a persistent Playwright browser profile to maintain your IRP session. Once connected, bearer tokens are refreshed automatically every hour — no manual steps needed.</p>
          <p>If the session expires (typically after 30+ days), click <strong>Connect to IRP</strong> above. An embedded browser will open here — log in as you normally would, and the session will be saved automatically.</p>
          <p>The browser profile is stored at: <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{session.profileDir || '.irp-browser-profile'}</code></p>
          <p className="text-xs text-gray-400">On Azure App Service, set <code className="rounded bg-gray-100 px-1 py-0.5">IRP_BROWSER_PROFILE=/home/irp-browser-profile</code> so the profile persists across deployments.</p>
        </div>
      )}
    </div>
  );
}

export default function ImportReleaseSettingsPage() {
  const inputRefs = {
    to: useRef(null),
    cc: useRef(null),
    subject_template: useRef(null),
  };
  const bodyEditorRef = useRef(null);
  const signatureEditorRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [savedForm, setSavedForm] = useState(emptyForm);
  const [activeField, setActiveField] = useState('body_html');
  const [activeTab, setActiveTab] = useState('builder');
  const [toast, setToast] = useState(null);
  const [testRecipient, setTestRecipient] = useState('');

  const settingsQuery = useQuery({
    queryKey: ['import-release-settings'],
    queryFn: getImportReleaseSettings,
  });
  const healthQuery = useQuery({
    queryKey: ['import-release-health'],
    queryFn: getImportReleaseHealth,
    refetchInterval: 60000,
  });
  const runsQuery = useQuery({
    queryKey: ['import-release-runs'],
    queryFn: () => getImportReleaseRuns(25),
    refetchInterval: 60000,
  });

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    const nextForm = {
      email: {
        to: data?.email?.to || '',
        cc: data?.email?.cc || '',
        subject_template: data?.email?.subject_template || '',
        body_html: data?.email?.body_html || '',
        signature_content_html: data?.email?.signature_content_html || '',
      },
    };
    setForm(nextForm);
    setSavedForm(nextForm);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: updateImportReleaseSettings,
    onSuccess: (data) => {
      const nextForm = {
        email: {
          to: data?.email?.to || '',
          cc: data?.email?.cc || '',
          subject_template: data?.email?.subject_template || '',
          body_html: data?.email?.body_html || '',
          signature_content_html: data?.email?.signature_content_html || '',
        },
      };
      setForm(nextForm);
      setSavedForm(nextForm);
      setToast({ type: 'success', message: 'Settings saved' });
      setTimeout(() => setToast(null), 2500);
    },
    onError: (error) => {
      setToast({ type: 'error', message: error.message });
      setTimeout(() => setToast(null), 3000);
    },
  });
  const testEmailMutation = useMutation({
    mutationFn: () => sendImportReleaseTestEmail(testRecipient),
    onSuccess: (data) => {
      setToast({ type: 'success', message: `Test email sent to ${data.to}` });
      setTimeout(() => setToast(null), 2500);
    },
    onError: (error) => {
      setToast({ type: 'error', message: error.message });
      setTimeout(() => setToast(null), 3000);
    },
  });
  const irpRefreshMutation = useMutation({
    mutationFn: refreshIrpSession,
    onSuccess: () => {
      setToast({ type: 'success', message: 'IRP token refreshed.' });
      setTimeout(() => setToast(null), 2500);
      healthQuery.refetch();
    },
    onError: (error) => {
      setToast({ type: 'error', message: error.message });
      setTimeout(() => setToast(null), 3000);
    },
  });
  const irpSetupStartMutation = useMutation({
    mutationFn: startIrpSetupSession,
    onSuccess: (data) => {
      if (data.alreadyConnected) {
        setToast({ type: 'success', message: 'Already connected — no login needed.' });
        setTimeout(() => setToast(null), 2500);
        healthQuery.refetch();
      } else if (data.started) {
        setActiveTab('irp');
      } else {
        setToast({ type: 'error', message: data.error || 'Could not start setup session.' });
        setTimeout(() => setToast(null), 3000);
      }
    },
    onError: (error) => {
      setToast({ type: 'error', message: error.message });
      setTimeout(() => setToast(null), 3000);
    },
  });
  const irpSetupStopMutation = useMutation({
    mutationFn: stopIrpSetupSession,
    onSuccess: () => healthQuery.refetch(),
  });

  const availableVariables = settingsQuery.data?.available_variables || [];
  const hasUnsavedChanges = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedForm), [form, savedForm]);

  const previewVariables = useMemo(() => {
    const signatureHtml = `${form.email.signature_content_html || ''}`;
    return {
      ...SAMPLE_VALUES,
      signature_html: signatureHtml,
    };
  }, [form.email.signature_content_html]);

  const previewSubject = renderTemplate(form.email.subject_template, previewVariables);
  const previewBody = renderTemplate(`${form.email.body_html || ''}\n{{signature_html}}`, previewVariables);
  const healthItems = [
    { label: 'Source Integration', ok: healthQuery.data?.sourceReachable, detail: healthQuery.data?.sourceDetail || (healthQuery.data?.sourceReachable ? 'Configured' : 'Missing configuration') },
    { label: 'IRP Auth', ok: healthQuery.data?.irpAuthValid, detail: healthQuery.data?.irpAuthDetail || (healthQuery.data?.irpAuthValid ? 'Connected' : (healthQuery.data?.irpAuthError || 'Invalid')) },
    { label: 'Email Integration', ok: healthQuery.data?.emailConfigured, detail: healthQuery.data?.emailDetail || (healthQuery.data?.emailConfigured ? 'Configured' : 'Missing configuration') },
    { label: 'Automation', ok: healthQuery.data?.automationRunning, detail: healthQuery.data?.automationDetail || (healthQuery.data?.fullJobRunning ? 'Running' : (healthQuery.data?.automationRunning ? 'Enabled' : 'Disabled')) },
  ];

  const setEmailField = (key, value) => {
    setForm((current) => ({ ...current, email: { ...current.email, [key]: value } }));
  };

  const insertVariable = (key) => {
    const token = `{{${key}}}`;
    if (activeField === 'body_html') {
      bodyEditorRef.current?.insertToken(token);
      return;
    }
    if (activeField === 'signature_content_html') {
      signatureEditorRef.current?.insertToken(token);
      return;
    }
    const input = inputRefs[activeField]?.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextValue = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
    setEmailField(activeField, nextValue);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                to="/import-release"
                title="Back to Import Release"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:border-[#714B67] hover:text-[#714B67]"
              >
                <ArrowLeft size={16} />
              </Link>
            <div className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1 text-xs font-medium text-gray-600">
              <Settings2 size={14} />
              Import Release Settings
            </div>
            </div>
            <h1 className="mt-3 text-2xl font-semibold">Notification Builder</h1>
            <p className="mt-1 text-sm text-gray-500">Use the small editor to format the message and signature visually. The system saves and sends the final email content automatically.</p>
          </div>
          <button
            type="button"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || settingsQuery.isLoading || !hasUnsavedChanges}
            className="inline-flex items-center gap-2 rounded-md bg-[#714B67] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a3c52] disabled:opacity-50"
          >
            <Save size={16} />
            {saveMutation.isPending ? 'Saving...' : hasUnsavedChanges ? 'Save Settings' : 'Saved'}
          </button>
        </div>

        {toast && (
          <div className={`rounded-md border px-4 py-3 text-sm ${toast.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
            <div className="flex items-center gap-2">
              {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              <span>{toast.message}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-b border-gray-200">
          {[
            { key: 'builder', label: 'Notification Builder' },
            { key: 'health', label: 'System Health' },
            { key: 'irp', label: 'IRP Connection' },
            { key: 'logs', label: 'Runtime Logs' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium ${activeTab === tab.key ? 'bg-white text-[#714B67] border-x border-t border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'builder' && (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-800">
                <Mail size={16} />
                Delivery
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">To</div>
                  <input
                    ref={inputRefs.to}
                    value={form.email.to}
                    onFocus={() => setActiveField('to')}
                    onChange={(e) => setEmailField('to', e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">CC</div>
                  <input
                    ref={inputRefs.cc}
                    value={form.email.cc}
                    onFocus={() => setActiveField('cc')}
                    onChange={(e) => setEmailField('cc', e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-md border border-dashed p-3 md:flex-row md:items-end">
                <label className="block flex-1">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Test Recipient</div>
                  <input
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    placeholder="Leave blank to use configured To"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => testEmailMutation.mutate()}
                  disabled={testEmailMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Send size={14} />
                  {testEmailMutation.isPending ? 'Sending...' : 'Send Test Email'}
                </button>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-800">
                <Variable size={16} />
                Message
              </div>
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Subject</div>
                  <input
                    ref={inputRefs.subject_template}
                    value={form.email.subject_template}
                    onFocus={() => setActiveField('subject_template')}
                    onChange={(e) => setEmailField('subject_template', e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]"
                  />
                </label>

                <RichTextEditor
                  ref={bodyEditorRef}
                  label="Body"
                  value={form.email.body_html}
                  onFocus={() => setActiveField('body_html')}
                  onChange={(value) => setEmailField('body_html', value)}
                  placeholder="Write the email body here..."
                />

                <RichTextEditor
                  ref={signatureEditorRef}
                  label="Signature"
                  value={form.email.signature_content_html}
                  onFocus={() => setActiveField('signature_content_html')}
                  onChange={(value) => setEmailField('signature_content_html', value)}
                  placeholder="Write the signature here..."
                />
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-5">
              <div className="mb-4 text-sm font-medium text-gray-800">Available Variables</div>
              <div className="flex flex-wrap gap-2">
                {availableVariables.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    title={item.description}
                    onClick={() => insertVariable(item.key)}
                    className="rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#714B67] hover:text-[#714B67]"
                  >
                    {`{{${item.key}}}`}
                  </button>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-500">Click a variable to insert it at the current cursor position.</div>
            </section>

            <section className="rounded-lg border bg-white p-5">
              <div className="mb-4 text-sm font-medium text-gray-800">Preview</div>
              <div className="rounded-md border bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Subject</div>
                <div className="mt-1 text-sm font-medium text-gray-900">{previewSubject}</div>
                <div className="mt-4 text-xs uppercase tracking-wide text-gray-500">Body</div>
                <div className="prose prose-sm mt-2 max-w-none rounded-md bg-white p-4" dangerouslySetInnerHTML={{ __html: previewBody }} />
              </div>
            </section>
          </div>
        </div>
        )}

        {activeTab === 'health' && (
          <div className="rounded-lg border bg-white p-5 space-y-4">
            <div className="text-sm font-medium text-gray-800">System Health</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {healthItems.map((item) => (
                <div key={item.label} className="rounded-md border border-gray-200 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{item.label}</div>
                  <div className={`mt-1 text-sm font-medium ${item.ok ? 'text-green-700' : 'text-red-700'}`}>{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-gray-500">IRP Connection</div>
                <button
                  type="button"
                  onClick={() => setActiveTab('irp')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#714B67] hover:text-[#714B67]"
                >
                  <Monitor size={12} />
                  Manage
                </button>
              </div>
              <div className="mt-1 text-sm font-medium text-gray-800">{healthQuery.data?.irpAuthDetail || '—'}</div>
              {healthQuery.data?.irpSession?.tokenExpiresAt && (
                <div className="mt-1 text-xs text-gray-500">
                  Token expires: {new Date(healthQuery.data.irpSession.tokenExpiresAt).toLocaleString()}
                </div>
              )}
            </div>
            <div className="rounded-md border border-gray-200 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Last Full Run</div>
              <div className="mt-1 text-sm font-medium text-gray-800">
                {healthQuery.data?.lastFullRunAt ? new Date(healthQuery.data.lastFullRunAt).toLocaleString() : 'No run yet'}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'irp' && (
          <IrpConnectionTab
            health={healthQuery.data}
            onRefreshHealth={healthQuery.refetch}
            irpRefreshMutation={irpRefreshMutation}
            irpSetupStartMutation={irpSetupStartMutation}
            irpSetupStopMutation={irpSetupStopMutation}
          />
        )}

        {activeTab === 'logs' && (
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <div className="text-sm font-medium text-gray-800">Runtime Logs</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Started</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">IRP</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {(runsQuery.data?.runs || []).map((run) => (
                    <tr key={run.id}>
                      <td className="px-4 py-3 font-medium uppercase">{run.type}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{run.sourceFetched != null ? `Fetched ${run.sourceFetched}, inserted ${run.sourceInserted || 0}, updated ${run.sourceUpdated || 0}` : (run.sourceError || '-')}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {run.irpChecked != null
                          ? `${run.irpChecked} attempted, ${run.irpCompleted || 0} completed, ${run.irpErrors || 0} failed`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{run.emailsSent != null ? `${run.emailsSent} sent, ${run.emailErrors || 0} failed` : '-'}</td>
                      <td className="px-4 py-3">
                        {run.skipped
                          ? <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{run.reason || 'Skipped'}</span>
                          : <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${run.status === 'issue' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>{run.status === 'issue' ? 'Issue' : 'Completed'}</span>}
                      </td>
                    </tr>
                  ))}
                  {!(runsQuery.data?.runs || []).length && <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">No runtime logs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
