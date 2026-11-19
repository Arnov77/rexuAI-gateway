import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiErrorPayload, api } from '../lib/api';
import { formatNumber, textFromMessage } from '../lib/format';
import { streamPlayground } from '../lib/sse';
import type { ChatMessage, Conversation, Model, UsageLog } from '../lib/types';

const STREAM_KEY = 'rexu-stream';
const MAX_TOKENS_KEY = 'rexu-max-tokens';
const MAX_TOKENS_CUSTOM_KEY = 'rexu-max-tokens-custom';
const TEMPERATURE_KEY = 'rexu-temperature';
const DEFAULT_TEMPERATURE = 0.7;

const MAX_TOKEN_PRESETS = ['256', '512', '1024', '2048', '4096'] as const;

type MaxTokensChoice = 'default' | (typeof MAX_TOKEN_PRESETS)[number] | 'custom';

function isMaxTokenPreset(value: string | null): value is (typeof MAX_TOKEN_PRESETS)[number] {
  return MAX_TOKEN_PRESETS.some((preset) => preset === value);
}

function readMaxTokensChoice(): MaxTokensChoice {
  const stored = window.localStorage.getItem(MAX_TOKENS_KEY);
  if (stored === 'default' || stored === 'custom') return stored;
  return isMaxTokenPreset(stored) ? stored : 'default';
}

function readTemperature(): number {
  const stored = window.localStorage.getItem(TEMPERATURE_KEY);
  if (stored == null) return DEFAULT_TEMPERATURE;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : DEFAULT_TEMPERATURE;
}

type PlaygroundError = {
  message: string;
  requestId: string | null;
};

function toPlaygroundError(caught: unknown, fallback: string): PlaygroundError {
  if (caught instanceof ApiError) {
    return { message: caught.message, requestId: caught.requestId };
  }
  return {
    message: caught instanceof Error ? caught.message : fallback,
    requestId: null,
  };
}

type LocalMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string | null;
  usageLogId?: string | null;
  pending?: boolean;
};

type PlaygroundResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function toChatMessages(messages: LocalMessage[]) {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
}

function fromServer(messages: ChatMessage[]): LocalMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      content: textFromMessage(message.content),
      modelId: message.modelId,
      usageLogId: message.usageLogId,
    }));
}

async function sendNonStream(
  body: unknown,
  signal: AbortSignal,
): Promise<{ content: string; conversationId: string | null; usageLogId: string | null }> {
  const response = await fetch('/api/user/playground/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();

  if (!response.ok) {
    let message = `Request gagal (${response.status})`;
    let code = 'request_failed';
    let requestId: string | null = null;
    try {
      const payload = JSON.parse(text) as ApiErrorPayload;
      message = payload.error?.message ?? message;
      code = payload.error?.code ?? code;
      requestId = payload.error?.request_id ?? null;
    } catch {
      // keep the status message
    }
    throw new ApiError(response.status, message, code, requestId);
  }

  let payload: PlaygroundResponse | null = null;
  try {
    payload = text ? (JSON.parse(text) as PlaygroundResponse) : null;
  } catch {
    payload = null;
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  return {
    content: typeof rawContent === 'string' ? rawContent : '',
    conversationId: response.headers.get('x-rexu-conversation-id'),
    usageLogId: response.headers.get('x-rexu-usage-log-id'),
  };
}

function ArrowUpIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1"
      role="status"
      aria-label="Model sedang mengetik"
    >
      <span
        className="typing-dot size-1.5 rounded-full bg-current opacity-60"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="typing-dot size-1.5 rounded-full bg-current opacity-60"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="typing-dot size-1.5 rounded-full bg-current opacity-60"
        style={{ animationDelay: '300ms' }}
      />
    </span>
  );
}

const historyDateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;

  return historyDateFormatter.format(date);
}

function truncateTitle(title: string, maxLength = 20): string {
  return title.length > maxLength ? `${title.slice(0, maxLength)}…` : title;
}

function MenuIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

type HistoryPanelProps = {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  busy: boolean;
  onSelect: (conversation: Conversation) => void;
  onNew: () => void;
};

function HistoryPanel({
  conversations,
  activeId,
  loading,
  busy,
  onSelect,
  onNew,
}: HistoryPanelProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-sm font-medium">Percakapan</p>
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="border border-line px-2 py-1 text-xs transition-colors duration-150 hover:border-ink hover:text-ink disabled:opacity-60"
        >
          Baru +
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 px-4 py-3" aria-hidden="true">
            {[0, 1, 2].map((item) => (
              <div key={item} className="animate-pulse space-y-2">
                <div className="h-4 rounded bg-ink/10" />
                <div className="h-3 w-2/3 rounded bg-ink/10" />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted">Belum ada percakapan.</p>
        ) : (
          <ul>
            {conversations.map((conversation) => {
              const active = activeId === conversation.id;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation)}
                    disabled={busy}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full flex-col items-start gap-1 border-b border-l-2 border-line px-4 py-3 text-left transition-colors duration-150 disabled:opacity-60 ${
                      active ? 'border-l-oxide bg-ink/5' : 'border-l-transparent hover:bg-ink/5'
                    }`}
                  >
                    <span className="w-full truncate text-sm">{conversation.title}</span>
                    <span className="font-mono text-xs text-muted">
                      {relativeTime(conversation.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const userBubble =
  'ml-auto max-w-[80%] rounded-tl-lg rounded-tr-lg rounded-bl-lg rounded-br-none bg-oxide px-4 py-2.5 text-sm leading-6 text-chalk whitespace-pre-wrap break-words';
const assistantBubble =
  'mr-auto max-w-[80%] rounded-tl-none rounded-tr-lg rounded-bl-lg rounded-br-lg bg-ink/8 px-4 py-2.5 text-sm leading-6 text-ink whitespace-pre-wrap break-words dark:bg-chalk/8';

export function PlaygroundPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<PlaygroundError | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usageByLogId, setUsageByLogId] = useState<Map<string, UsageLog>>(() => new Map());
  const [streamEnabled, setStreamEnabled] = useState(
    () => window.localStorage.getItem(STREAM_KEY) !== 'off',
  );
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxTokensChoice, setMaxTokensChoice] = useState<MaxTokensChoice>(readMaxTokensChoice);
  const [customMaxTokens, setCustomMaxTokens] = useState(
    () => window.localStorage.getItem(MAX_TOKENS_CUSTOM_KEY) ?? '1024',
  );
  const [temperature, setTemperature] = useState(readTemperature);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadConversations = useCallback(async () => {
    const data = await api<{ data: Conversation[] }>('/api/user/conversations');
    setConversations(data.data);
    return data.data;
  }, []);

  const loadUsage = useCallback(async () => {
    const data = await api<{ data: UsageLog[] }>('/api/user/usage?limit=100');
    setUsageByLogId(new Map(data.data.map((log) => [log.id, log])));
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const data = await api<{ data: ChatMessage[] }>(
      `/api/user/conversations/${conversationId}/messages`,
    );
    setMessages(fromServer(data.data));
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [modelData, conversationData] = await Promise.all([
          api<{ data: Model[] }>('/api/user/models'),
          api<{ data: Conversation[] }>('/api/user/conversations'),
          loadUsage(),
        ]);
        setModels(modelData.data);
        setConversations(conversationData.data);
        setModel((current) => current || modelData.data[0]?.id || '');
      } catch (caught) {
        setError(toPlaygroundError(caught, 'Gagal memuat data'));
      } finally {
        setConversationsLoading(false);
      }
    }
    void load();
  }, [loadUsage]);

  useEffect(() => {
    if (!historyOpen) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setHistoryOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref is stable
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, error]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize follows the input value
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight + 2, 116)}px`;
  }, [input]);

  async function openConversation(conversation: Conversation) {
    if (streaming) return;
    setActiveId(conversation.id);
    setHistoryOpen(false);
    setError(null);
    if (conversation.defaultModelId) setModel(conversation.defaultModelId);
    try {
      await loadMessages(conversation.id);
    } catch (caught) {
      setError(toPlaygroundError(caught, 'Gagal memuat percakapan'));
    }
  }

  function newConversation() {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
  }

  function toggleStream() {
    setStreamEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(STREAM_KEY, next ? 'on' : 'off');
      return next;
    });
  }

  function selectMaxTokens(choice: MaxTokensChoice) {
    setMaxTokensChoice(choice);
    window.localStorage.setItem(MAX_TOKENS_KEY, choice);
  }

  function changeCustomMaxTokens(value: string) {
    setCustomMaxTokens(value);
    window.localStorage.setItem(MAX_TOKENS_CUSTOM_KEY, value);
  }

  function changeTemperature(value: number) {
    setTemperature(value);
    window.localStorage.setItem(TEMPERATURE_KEY, String(value));
  }

  function resetAdvanced() {
    changeTemperature(DEFAULT_TEMPERATURE);
  }

  function resolveMaxTokens(): number | null {
    if (maxTokensChoice === 'default') return null;
    const value = Number(maxTokensChoice === 'custom' ? customMaxTokens : maxTokensChoice);
    if (!Number.isFinite(value) || value < 1) return null;
    return Math.min(32000, Math.floor(value));
  }

  async function send() {
    const text = input.trim();
    if (!text || !model || streaming) return;

    setInput('');
    setError(null);
    const userMessage: LocalMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const nextMessages = [...messages, userMessage];
    setMessages([
      ...nextMessages,
      { id: assistantId, role: 'assistant', content: '', modelId: model, pending: true },
    ]);
    setStreaming(true);
    const controller = new AbortController();

    const system = systemPrompt.trim();
    const maxTokens = resolveMaxTokens();
    const body = {
      conversationId: activeId ?? undefined,
      model,
      messages: system
        ? [{ role: 'system' as const, content: system }, ...toChatMessages(nextMessages)]
        : toChatMessages(nextMessages),
      ...(maxTokens == null ? {} : { max_tokens: maxTokens }),
      temperature,
      stream: streamEnabled,
    };

    try {
      if (streamEnabled) {
        const response = await streamPlayground(
          body,
          {
            onEvent: (event) => {
              const delta = event.content;
              if (!delta) return;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + delta }
                    : message,
                ),
              );
            },
            onDone: () => {
              setStreaming(false);
            },
            onError: (caught) => {
              setError(toPlaygroundError(caught, 'Request gagal'));
              setStreaming(false);
            },
          },
          controller.signal,
        );

        const usageLogId = response.headers.get('x-rexu-usage-log-id');
        if (usageLogId) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, usageLogId, pending: false } : message,
            ),
          );
        }

        const conversationId = response.headers.get('x-rexu-conversation-id');
        if (conversationId) {
          setActiveId(conversationId);
          await loadMessages(conversationId);
          await loadConversations();
        }
      } else {
        const result = await sendNonStream(body, controller.signal);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: result.content,
                  usageLogId: result.usageLogId,
                  pending: false,
                }
              : message,
          ),
        );
        if (result.conversationId) {
          setActiveId(result.conversationId);
          await loadMessages(result.conversationId);
          await loadConversations();
        }
      }

      await loadUsage();
    } catch (caught) {
      setError(toPlaygroundError(caught, 'Request gagal'));
      setStreaming(false);
      setMessages((current) =>
        current.filter((message) => !(message.id === assistantId && !message.content)),
      );
    } finally {
      setStreaming(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const activeConversationTitle =
    conversations.find((conversation) => conversation.id === activeId)?.title ?? null;

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 overflow-hidden md:h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line lg:flex">
        <HistoryPanel
          conversations={conversations}
          activeId={activeId}
          loading={conversationsLoading}
          busy={streaming}
          onSelect={(conversation) => void openConversation(conversation)}
          onNew={newConversation}
        />
      </aside>

      <button
        type="button"
        aria-label="Tutup history"
        onClick={() => setHistoryOpen(false)}
        aria-hidden={!historyOpen}
        tabIndex={historyOpen ? 0 : -1}
        className={`fixed inset-0 z-20 bg-black/50 transition-opacity duration-200 lg:hidden ${
          historyOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        id="playground-history"
        aria-label="History percakapan"
        inert={!historyOpen}
        className={`fixed top-14 bottom-0 left-0 z-30 flex w-72 max-w-[80vw] flex-col overflow-y-auto border-r border-line bg-paper transition-transform duration-200 ease-out md:top-0 lg:hidden dark:bg-[#0f0f0d] ${
          historyOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <HistoryPanel
          conversations={conversations}
          activeId={activeId}
          loading={conversationsLoading}
          busy={streaming}
          onSelect={(conversation) => void openConversation(conversation)}
          onNew={newConversation}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-chalk dark:bg-chalk/5">
          <div className="flex items-center justify-between gap-2 px-3 py-2 lg:hidden">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-expanded={historyOpen}
              aria-controls="playground-history"
              className="-ml-1 inline-flex shrink-0 items-center gap-1.5 p-2 text-muted transition-colors duration-150 hover:text-ink"
            >
              <MenuIcon className="size-5" />
              <span className="text-xs">History</span>
            </button>
            <p
              className={`min-w-0 flex-1 truncate text-center text-sm font-medium ${
                activeConversationTitle ? '' : 'text-muted'
              }`}
            >
              {activeConversationTitle ? truncateTitle(activeConversationTitle) : 'Playground'}
            </p>
            <button
              type="button"
              onClick={newConversation}
              disabled={streaming}
              className="shrink-0 border border-line px-2 py-1 text-xs text-ink transition-colors duration-150 hover:border-ink disabled:opacity-60"
            >
              Baru +
            </button>
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:border-t-0">
            <label className="w-full lg:w-56">
              <span className="sr-only">Model</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={streaming}
                className="min-h-9 w-full border border-line bg-paper px-2 font-mono text-xs text-ink outline-none focus:border-ink disabled:text-muted dark:bg-chalk/5"
              >
                {models.length === 0 ? <option value="">Belum ada model aktif</option> : null}
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="text-xs text-muted">Max tokens</span>
              <select
                value={maxTokensChoice}
                onChange={(event) => selectMaxTokens(event.target.value as MaxTokensChoice)}
                disabled={streaming}
                className="min-h-8 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink disabled:text-muted dark:bg-chalk/5"
              >
                <option value="default">Default</option>
                {MAX_TOKEN_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>

            {maxTokensChoice === 'custom' ? (
              <input
                type="number"
                min={1}
                max={32000}
                step={1}
                value={customMaxTokens}
                onChange={(event) => changeCustomMaxTokens(event.target.value)}
                disabled={streaming}
                aria-label="Max tokens custom"
                className="min-h-8 w-24 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink disabled:text-muted dark:bg-chalk/5"
              />
            ) : null}

            <button
              type="button"
              onClick={toggleStream}
              disabled={streaming}
              aria-pressed={streamEnabled}
              className="inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-2.5 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink disabled:opacity-60 dark:bg-chalk/5"
            >
              <span
                className={`size-1.5 rounded-full ${streamEnabled ? 'bg-emerald-500' : 'bg-muted'}`}
              />
              {streamEnabled ? 'Stream on' : 'Stream off'}
            </button>

            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              aria-expanded={advancedOpen}
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
            >
              Lanjutan {advancedOpen ? '▴' : '▾'}
            </button>

            <button
              type="button"
              onClick={() => setSystemOpen((current) => !current)}
              aria-expanded={systemOpen}
              className="inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
            >
              System prompt
              {systemPrompt.trim() ? <span className="size-1.5 rounded-full bg-oxide" /> : null}
            </button>
          </div>

          {advancedOpen ? (
            <div className="border-t border-line px-3 py-2 sm:px-4">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="temperature" className="text-xs text-muted">
                  Temperatur
                </label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => changeTemperature(Number(event.target.value))}
                  className="min-w-40 flex-1 accent-oxide"
                />
                <span className="w-10 text-right font-mono text-sm tnum">
                  {temperature.toFixed(1)}
                </span>
                <button
                  type="button"
                  onClick={resetAdvanced}
                  className="text-xs text-muted hover:text-ink"
                >
                  Reset ke default
                </button>
              </div>
            </div>
          ) : null}

          {systemOpen ? (
            <div className="border-t border-line px-3 py-2 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="system-prompt" className="text-xs text-muted">
                  System prompt (opsional)
                </label>
                <button
                  type="button"
                  onClick={() => setSystemPrompt('')}
                  aria-label="Hapus system prompt"
                  className="px-1 text-base leading-none text-muted hover:text-ink"
                >
                  ×
                </button>
              </div>
              <textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={3}
                placeholder="Anda adalah asisten yang membantu..."
                className="mt-1 block w-full resize-none border border-line bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
              />
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {models.length === 0 && !error ? (
            <div className="mx-auto max-w-md border-t border-line pt-6">
              <h3 className="text-lg font-semibold">Belum ada model aktif</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Admin perlu mengaktifkan model sebelum bisa dipakai di Playground.
              </p>
            </div>
          ) : (
            <>
              {messages.length === 0 && !error ? (
                <div className="mx-auto max-w-lg pt-10">
                  <p className="font-mono text-xs text-muted">{model || 'pilih model'}</p>
                  <h3 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.04em]">
                    Mulai dari satu pertanyaan.
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                    Kirim pesan, lalu lihat pemakaian token dan RC di bawah setiap jawaban.
                  </p>
                </div>
              ) : null}

              <div className="mx-auto flex max-w-3xl flex-col gap-3" aria-live="polite">
                {messages.map((message) => {
                  const usageLog = message.usageLogId
                    ? usageByLogId.get(message.usageLogId)
                    : undefined;

                  if (message.role === 'user') {
                    return (
                      <div key={message.id} className="flex justify-end">
                        <div className={userBubble}>{message.content}</div>
                      </div>
                    );
                  }

                  return (
                    <div key={message.id} className="flex flex-col items-start">
                      <div className={assistantBubble}>
                        {message.pending && !message.content ? <TypingDots /> : message.content}
                      </div>
                      {usageLog ? (
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {formatNumber(usageLog.promptTokens)} in ·{' '}
                          {formatNumber(usageLog.completionTokens)} out ·{' '}
                          {formatNumber(usageLog.rcDeducted)} RC
                        </p>
                      ) : null}
                    </div>
                  );
                })}

                {error ? (
                  <div className="mr-auto w-full max-w-[85%] border-l-2 border-oxide bg-oxide/5 px-4 py-3">
                    <p className="text-sm leading-6 text-ink">⚠ {error.message}</p>
                    {error.requestId ? (
                      <p className="mt-1 font-mono text-xs text-muted">ID: {error.requestId}</p>
                    ) : null}
                  </div>
                ) : null}

                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-line bg-chalk p-3 pb-4 sm:p-4 dark:bg-chalk/5">
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="playground-input">
              Pesan
            </label>
            <textarea
              ref={inputRef}
              id="playground-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={streaming || models.length === 0}
              placeholder={models.length === 0 ? 'Aktifkan model terlebih dahulu' : 'Tulis pesan'}
              className="max-h-[116px] min-h-10 flex-1 resize-none overflow-y-auto border border-line bg-paper px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-ink disabled:text-muted dark:bg-chalk/5"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={streaming || !input.trim() || !model}
              aria-label="Kirim pesan"
              className="grid size-10 shrink-0 place-items-center border border-oxide bg-oxide text-chalk transition-colors duration-150 hover:border-petrol hover:bg-petrol disabled:border-line disabled:bg-paper disabled:text-muted"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Enter untuk kirim. Shift+Enter untuk baris baru.
          </p>
        </div>
      </div>
    </div>
  );
}
