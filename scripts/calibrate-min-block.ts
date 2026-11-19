import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, loadEnv, schema } from '../packages/db/src/index.js';

loadEnv();

const API_BASE_URL = (
  process.env.API_BASE_URL ??
  process.env.REXU_BASE_URL ??
  'http://localhost:3001'
).replace(/\/+$/, '');
const BANKAI_BASE_URL = (process.env.BANKAI_BASE_URL ?? '').replace(/\/+$/, '');
const BANKAI_API_KEY = process.env.BANKAI_API_KEY?.trim() ?? '';
const BANKAI_QUOTA_PATH = process.env.BANKAI_QUOTA_PATH ?? '/v1/quota';
const TEST_API_KEY = process.env.TEST_API_KEY?.trim() ?? '';
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? '';

const REQUESTS_PER_MODEL = 3;
const REQUEST_TIMEOUT_MS = 120_000;
const PRE_REQUEST_DELAY_MS = 1_000;
const POST_REQUESTS_DELAY_MS = 2_000;
const BETWEEN_MODELS_DELAY_MS = 2_000;
const MIN_BLOCK_FACTOR = 1.5;
const VARIANCE_THRESHOLD_PERCENT = 20;

const numberFormatter = new Intl.NumberFormat('id-ID');
const decimalFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

const { models: modelsTable } = schema;

type ModelRow = {
  id: string;
  bankaiMultiplierBp: number;
  isEnabled: boolean;
  isAvailable: boolean;
};

type RequestDetail = {
  index: number;
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
};

type ModelCalibration = {
  modelId: string;
  bankaiMultiplierBp: number | null;
  status: 'ok' | 'unavailable' | 'failed' | 'not_found';
  statusDetail: string | null;
  avgRawTokens: number | null;
  rawStdDev: number | null;
  variancePercent: number | null;
  inconsistent: boolean;
  totalRawTokens: number | null;
  quotaBefore: number | null;
  quotaAfter: number | null;
  quotaDelta: number | null;
  avgBankAICharge: number | null;
  expectedCharge: number | null;
  estimatedMinBlock: number | null;
  isMinBlock: boolean;
  requestsSucceeded: number;
  requests: RequestDetail[];
};

type Report = {
  timestamp: string;
  models: ModelCalibration[];
  sqlUpdates: string[];
  applied: string[];
  notes: string[];
};

type MinBlockUpdate = {
  modelId: string;
  minBlockOverride: number;
};

const SKIPPABLE_ERROR_CODES = new Set([
  'model_unavailable',
  'model_not_found',
  'not_enabled',
  'model_disabled',
]);

function required(name: string, value: string): string {
  if (!value) {
    console.error(`❌ ${name} tidak ditemukan. Pastikan sudah diisi di .env atau environment.`);
    process.exit(1);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseModelsOverride(argv: string[]): string[] | null {
  let raw: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--models') {
      raw = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--models=')) {
      raw = arg.slice('--models='.length);
    }
  }

  if (raw == null) return null;

  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    console.error('❌ --models diberikan tetapi daftar model kosong.');
    process.exit(1);
  }
  return ids;
}

function parseApply(argv: string[]): boolean {
  return argv.includes('--apply');
}

async function fetchBankaiQuota(): Promise<number> {
  const response = await fetch(`${BANKAI_BASE_URL}${BANKAI_QUOTA_PATH}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${BANKAI_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} dari ${BANKAI_BASE_URL}${BANKAI_QUOTA_PATH}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const remaining = Number(
    body.remainingTokens ?? body.remaining_tokens ?? body.remaining_quota ?? Number.NaN,
  );
  if (!Number.isFinite(remaining)) {
    throw new Error('Response quota tidak mengandung remainingTokens');
  }
  return remaining;
}

function extractUsage(body: unknown): {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
} {
  if (typeof body !== 'object' || body === null) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const usage = (body as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const record = usage as Record<string, unknown>;
  return {
    promptTokens: numberOrNull(record.prompt_tokens),
    completionTokens: numberOrNull(record.completion_tokens),
    totalTokens: numberOrNull(record.total_tokens),
  };
}

function extractError(
  body: unknown,
  fallbackText: string,
): { code: string | null; message: string } {
  if (typeof body === 'object' && body !== null) {
    const error = (body as Record<string, unknown>).error;
    if (typeof error === 'object' && error !== null) {
      const record = error as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : null,
        message: typeof record.message === 'string' ? record.message : 'upstream error',
      };
    }
    if (typeof error === 'string') return { code: null, message: error };
  }
  const message = fallbackText.trim().slice(0, 200);
  return { code: null, message: message || 'upstream error' };
}

async function sendMinimalRequest(modelId: string, index: number): Promise<RequestDetail> {
  const started = Date.now();

  try {
    const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const bodyText = await response.text();
    let body: unknown = null;
    try {
      body = bodyText ? (JSON.parse(bodyText) as unknown) : null;
    } catch {
      body = null;
    }

    const usage = extractUsage(body);
    const error = response.ok ? null : extractError(body, bodyText);
    const usageMissing =
      response.ok && usage.promptTokens == null && usage.completionTokens == null;

    return {
      index,
      httpStatus: response.status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      latencyMs: Date.now() - started,
      errorCode: error?.code ?? (usageMissing ? 'usage_missing' : null),
      errorMessage: error?.message ?? (usageMissing ? 'usage tidak ditemukan' : null),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    return {
      index,
      httpStatus: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      latencyMs: Date.now() - started,
      errorCode: name === 'TimeoutError' ? 'timeout' : 'network_error',
      errorMessage: name === 'TimeoutError' ? `timeout setelah ${REQUEST_TIMEOUT_MS}ms` : message,
    };
  }
}

function unavailableReason(detail: RequestDetail): string | null {
  if (detail.httpStatus === 404) return 'HTTP 404';
  if (detail.errorCode != null && SKIPPABLE_ERROR_CODES.has(detail.errorCode)) {
    return detail.errorCode;
  }
  return null;
}

function rawTokensOf(detail: RequestDetail): number {
  return (detail.promptTokens ?? 0) + (detail.completionTokens ?? 0);
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function emptyCalibration(
  row: ModelRow,
  status: ModelCalibration['status'],
  statusDetail: string,
): ModelCalibration {
  return {
    modelId: row.id,
    bankaiMultiplierBp: row.bankaiMultiplierBp,
    status,
    statusDetail,
    avgRawTokens: null,
    rawStdDev: null,
    variancePercent: null,
    inconsistent: false,
    totalRawTokens: null,
    quotaBefore: null,
    quotaAfter: null,
    quotaDelta: null,
    avgBankAICharge: null,
    expectedCharge: null,
    estimatedMinBlock: null,
    isMinBlock: false,
    requestsSucceeded: 0,
    requests: [],
  };
}

async function calibrateModel(row: ModelRow): Promise<ModelCalibration> {
  if (!row.isEnabled) {
    return emptyCalibration(row, 'unavailable', 'is_enabled=false');
  }
  if (!row.isAvailable) {
    return emptyCalibration(row, 'unavailable', 'is_available=false');
  }

  let quotaBefore: number;
  try {
    quotaBefore = await fetchBankaiQuota();
  } catch (error) {
    return emptyCalibration(
      row,
      'failed',
      `quota awal gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await sleep(PRE_REQUEST_DELAY_MS);

  const requests: RequestDetail[] = [];
  let unavailable: string | null = null;

  for (let i = 0; i < REQUESTS_PER_MODEL; i += 1) {
    const detail = await sendMinimalRequest(row.id, i + 1);
    requests.push(detail);

    const reason = unavailableReason(detail);
    if (reason != null) {
      unavailable = reason;
      break;
    }
  }

  await sleep(POST_REQUESTS_DELAY_MS);

  let quotaAfter: number;
  try {
    quotaAfter = await fetchBankaiQuota();
  } catch (error) {
    return {
      ...emptyCalibration(
        row,
        'failed',
        `quota akhir gagal: ${error instanceof Error ? error.message : String(error)}`,
      ),
      quotaBefore,
      requests,
    };
  }

  let quotaDelta = quotaBefore - quotaAfter;
  if (quotaDelta <= 0) {
    // Kadang counter quota BankAI terlambat update. Beri satu kesempatan lagi.
    await sleep(POST_REQUESTS_DELAY_MS);
    try {
      const retry = await fetchBankaiQuota();
      const retryDelta = quotaBefore - retry;
      if (retryDelta > quotaDelta) {
        quotaAfter = retry;
        quotaDelta = retryDelta;
      }
    } catch {
      // Pakai hasil pertama.
    }
  }

  const successful = requests.filter(
    (detail) =>
      detail.httpStatus === 200 && detail.promptTokens != null && detail.completionTokens != null,
  );
  const rawValues = successful.map(rawTokensOf);
  const totalRawTokens = rawValues.reduce((sum, value) => sum + value, 0);
  const avgRawTokens = totalRawTokens / REQUESTS_PER_MODEL;
  const meanRawTokens = rawValues.length > 0 ? totalRawTokens / rawValues.length : 0;
  const rawStdDev = standardDeviation(rawValues);
  const variancePercent = meanRawTokens > 0 ? (rawStdDev / meanRawTokens) * 100 : 0;
  const inconsistent =
    rawValues.length === REQUESTS_PER_MODEL && variancePercent > VARIANCE_THRESHOLD_PERCENT;

  const avgBankAICharge = quotaDelta / REQUESTS_PER_MODEL;
  const expectedCharge = (avgRawTokens * row.bankaiMultiplierBp) / 10_000;
  const isMinBlock =
    expectedCharge > 0 ? avgBankAICharge > expectedCharge * MIN_BLOCK_FACTOR : avgBankAICharge > 0;
  const estimatedMinBlock = Math.round(avgBankAICharge);

  let status: ModelCalibration['status'] = 'ok';
  let statusDetail: string | null = null;

  if (unavailable != null) {
    status = 'unavailable';
    statusDetail = unavailable;
  } else if (successful.length !== REQUESTS_PER_MODEL) {
    status = 'failed';
    statusDetail = `${successful.length}/${REQUESTS_PER_MODEL} request berhasil`;
  } else if (quotaDelta < 0) {
    status = 'failed';
    statusDetail = 'quota BankAI bertambah (refill?)';
  } else if (quotaDelta === 0) {
    status = 'failed';
    statusDetail = 'quota BankAI tidak berubah';
  } else if (inconsistent) {
    statusDetail = `stddev raw token ${decimalFormatter.format(variancePercent)}% (>20%)`;
  }

  return {
    modelId: row.id,
    bankaiMultiplierBp: row.bankaiMultiplierBp,
    status,
    statusDetail,
    avgRawTokens,
    rawStdDev,
    variancePercent,
    inconsistent,
    totalRawTokens,
    quotaBefore,
    quotaAfter,
    quotaDelta,
    avgBankAICharge,
    expectedCharge,
    estimatedMinBlock,
    isMinBlock,
    requestsSucceeded: successful.length,
    requests,
  };
}

function printProgress(index: number, total: number, calibration: ModelCalibration): void {
  const prefix = `  [${index}/${total}] ${calibration.modelId}`;

  if (calibration.status === 'unavailable') {
    console.log(`${prefix} — tidak tersedia (${calibration.statusDetail ?? 'unknown'})`);
    return;
  }
  if (calibration.status === 'not_found') {
    console.log(`${prefix} — tidak ada di DB`);
    return;
  }
  if (calibration.status === 'failed') {
    console.log(`${prefix} — gagal (${calibration.statusDetail ?? 'unknown'})`);
    return;
  }

  const suffix = calibration.inconsistent ? ' (TIDAK KONSISTEN)' : '';
  console.log(
    `${prefix} — raw: ${formatNumber(Math.round(calibration.avgRawTokens ?? 0))} tok, ` +
      `charge: ${formatNumber(Math.round(calibration.avgBankAICharge ?? 0))}, ` +
      `min_block: ~${formatNumber(calibration.estimatedMinBlock ?? 0)}${suffix}`,
  );
}

type TableColumn = {
  header: [string, string];
  width: number;
  align: 'left' | 'right';
};

function padCell(value: string, width: number, align: 'left' | 'right'): string {
  const innerWidth = Math.max(0, width - 2);
  const text = align === 'left' ? value.padEnd(innerWidth) : value.padStart(innerWidth);
  return ` ${text} `;
}

function renderCalibrationTable(rows: ModelCalibration[]): string[] {
  const modelValues = rows.map((row) => `${row.modelId}${row.inconsistent ? ' *' : ''}`);
  const rawValues = rows.map((row) => formatNumber(Math.round(row.avgRawTokens ?? 0)));
  const chargeValues = rows.map((row) => formatNumber(Math.round(row.avgBankAICharge ?? 0)));
  const expectedValues = rows.map((row) => formatNumber(Math.round(row.expectedCharge ?? 0)));
  const minBlockValues = rows.map((row) => formatNumber(row.estimatedMinBlock ?? 0));

  function columnWidth(values: string[], minimum: number, headers: string[]): number {
    return Math.max(
      minimum,
      ...headers.map((header) => header.length + 2),
      ...values.map((value) => value.length + 2),
    );
  }

  const modelWidth = columnWidth(modelValues, 23, ['Model']);
  const rawWidth = columnWidth(rawValues, 8, ['Raw', 'Token']);
  const chargeWidth = columnWidth(chargeValues, 9, ['BankAI', 'Charge']);
  const expectedWidth = columnWidth(expectedValues, 10, ['Expected', '(formula)']);
  const minBlockWidth = columnWidth(minBlockValues, 15, ['Min Block', 'Est']);

  const columns: TableColumn[] = [
    { header: ['Model', ''], width: modelWidth, align: 'left' },
    { header: ['Raw', 'Token'], width: rawWidth, align: 'right' },
    { header: ['BankAI', 'Charge'], width: chargeWidth, align: 'right' },
    { header: ['Expected', '(formula)'], width: expectedWidth, align: 'right' },
    { header: ['Min Block', 'Est'], width: minBlockWidth, align: 'right' },
  ];

  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0) + columns.length - 1;
  const title = 'HASIL KALIBRASI MINIMUM BLOCK';
  const titlePadding = Math.max(0, totalWidth - title.length);
  const titleLeft = Math.floor(titlePadding / 2);
  const titleRight = titlePadding - titleLeft;

  const top = `╔${columns.map((column) => '═'.repeat(column.width)).join('╦')}╗`;
  const divider = `╠${columns.map((column) => '═'.repeat(column.width)).join('╬')}╣`;
  const bottom = `╚${columns.map((column) => '═'.repeat(column.width)).join('╩')}╝`;

  const lines: string[] = [];
  lines.push(top);
  lines.push(`║${' '.repeat(titleLeft)}${title}${' '.repeat(titleRight)}║`);
  lines.push(divider);
  for (let headerIndex = 0; headerIndex < 2; headerIndex += 1) {
    lines.push(
      `║${columns
        .map((column) => padCell(column.header[headerIndex] ?? '', column.width, 'left'))
        .join('║')}║`,
    );
  }
  lines.push(divider);

  for (const row of rows) {
    const marker = row.inconsistent ? ' *' : '';
    const cells = [
      `${row.modelId}${marker}`,
      formatNumber(Math.round(row.avgRawTokens ?? 0)),
      formatNumber(Math.round(row.avgBankAICharge ?? 0)),
      formatNumber(Math.round(row.expectedCharge ?? 0)),
      formatNumber(row.estimatedMinBlock ?? 0),
    ];
    lines.push(
      `║${columns
        .map((column, index) => padCell(cells[index] ?? '', column.width, column.align))
        .join('║')}║`,
    );
  }

  lines.push(bottom);
  return lines;
}

function buildUpdates(calibrations: ModelCalibration[]): MinBlockUpdate[] {
  return calibrations
    .filter(
      (calibration) =>
        calibration.status === 'ok' &&
        !calibration.inconsistent &&
        calibration.isMinBlock &&
        (calibration.estimatedMinBlock ?? 0) > 0,
    )
    .map((calibration) => ({
      modelId: calibration.modelId,
      minBlockOverride: calibration.estimatedMinBlock ?? 0,
    }));
}

function sqlForUpdate(update: MinBlockUpdate): string {
  return (
    `UPDATE models SET min_block_override = ${update.minBlockOverride}\n` +
    `  WHERE id = '${update.modelId.replace(/'/g, "''")}';`
  );
}

function writeReportFile(report: Report): string {
  const directory = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(directory, { recursive: true });
  const fileTimestamp = report.timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(directory, `calibration-${fileTimestamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

async function main(): Promise<void> {
  required('TEST_API_KEY', TEST_API_KEY);
  required('BANKAI_API_KEY', BANKAI_API_KEY);
  required('BANKAI_BASE_URL', BANKAI_BASE_URL);
  required('DATABASE_URL', DATABASE_URL);

  const argv = process.argv.slice(2);
  const override = parseModelsOverride(argv);
  const apply = parseApply(argv);
  let rows: ModelRow[];

  try {
    rows = await getDb()
      .select({
        id: modelsTable.id,
        bankaiMultiplierBp: modelsTable.bankaiMultiplierBp,
        isEnabled: modelsTable.isEnabled,
        isAvailable: modelsTable.isAvailable,
      })
      .from(modelsTable)
      .where(override ? inArray(modelsTable.id, override) : eq(modelsTable.isEnabled, true))
      .orderBy(modelsTable.id);
  } catch (error) {
    console.error(
      `❌ Gagal membaca models dari DB: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const targetIds = override ?? rows.map((row) => row.id);
  const missingIds = override?.filter((id) => !rowsById.has(id)) ?? [];

  if (targetIds.length === 0) {
    console.error('❌ Tidak ada model enabled di DB. Gunakan --models untuk memilih model.');
    process.exitCode = 1;
    return;
  }

  console.log('🔧 Kalibrasi Minimum Block BankAI');
  console.log(`   API      : ${API_BASE_URL}`);
  console.log(`   Upstream : ${BANKAI_BASE_URL}`);
  console.log(`   Database : ${new URL(DATABASE_URL).host}`);
  console.log(
    `   Model    : ${targetIds.length}${override ? ' (override --models)' : ' (semua is_enabled=true)'}`,
  );
  console.log(`   Request  : ${REQUESTS_PER_MODEL} request/model, prompt "hi", max_tokens=1`);
  console.log(`   Mode     : ${apply ? '--apply (update DB)' : 'dry-run (SQL saja)'}`);
  if (!override && targetIds.length > 10) {
    console.log(
      '⚠️  Mode default menguji semua model enabled. Gunakan --models a,b untuk subset lebih cepat.',
    );
  }

  const calibrations: ModelCalibration[] = [];

  if (missingIds.length > 0) {
    for (const id of missingIds) {
      calibrations.push({
        modelId: id,
        bankaiMultiplierBp: null,
        status: 'not_found',
        statusDetail: 'tidak ditemukan di tabel models',
        avgRawTokens: null,
        rawStdDev: null,
        variancePercent: null,
        inconsistent: false,
        totalRawTokens: null,
        quotaBefore: null,
        quotaAfter: null,
        quotaDelta: null,
        avgBankAICharge: null,
        expectedCharge: null,
        estimatedMinBlock: null,
        isMinBlock: false,
        requestsSucceeded: 0,
        requests: [],
      });
    }
  }

  let index = 0;
  for (const id of targetIds) {
    index += 1;
    const row = rowsById.get(id);
    if (!row) continue;

    const calibration = await calibrateModel(row);
    calibrations.push(calibration);
    printProgress(index, targetIds.length, calibration);

    if (index < targetIds.length) await sleep(BETWEEN_MODELS_DELAY_MS);
  }

  const measured = calibrations.filter((calibration) => calibration.status === 'ok');
  const skipped = calibrations.filter((calibration) => calibration.status !== 'ok');

  console.log('');
  if (measured.length > 0) {
    for (const line of renderCalibrationTable(measured)) console.log(line);
    if (measured.some((calibration) => calibration.inconsistent)) {
      console.log('  * stddev raw token >20% — perlu cek manual, SQL tidak dibuat.');
    }
  } else {
    console.log('Tidak ada model yang berhasil dikalibrasi.');
  }

  if (skipped.length > 0) {
    console.log('\nTidak tersedia / gagal:');
    for (const calibration of skipped) {
      console.log(`  - ${calibration.modelId}: ${calibration.statusDetail ?? calibration.status}`);
    }
  }

  const updates = buildUpdates(calibrations);
  const sqlUpdates = updates.map(sqlForUpdate);
  console.log('\n-- Jalankan di DB untuk update min_block_override');
  if (sqlUpdates.length > 0) {
    for (const [sqlIndex, statement] of sqlUpdates.entries()) {
      if (sqlIndex > 0) console.log('');
      console.log(statement);
    }
  } else {
    console.log('-- Tidak ada model dengan minimum block yang perlu di-update.');
  }

  const notUpdated = calibrations.filter(
    (calibration) =>
      calibration.status === 'ok' && !calibration.inconsistent && !calibration.isMinBlock,
  );
  if (notUpdated.length > 0) {
    console.log(
      `-- Tidak di-update (isMinBlock=false): ${notUpdated.map((row) => row.modelId).join(', ')}`,
    );
  }

  const applied: string[] = [];
  if (apply && updates.length > 0) {
    for (const update of updates) {
      await getDb()
        .update(modelsTable)
        .set({ minBlockOverride: update.minBlockOverride })
        .where(eq(modelsTable.id, update.modelId));
      applied.push(update.modelId);
    }
    console.log(`\n✅ ${applied.length} model di-update langsung ke models.min_block_override.`);
  } else if (!apply) {
    console.log('\n-- Mode dry-run: SQL tidak dijalankan. Tambahkan --apply untuk mengeksekusi.');
  }

  const report: Report = {
    timestamp: new Date().toISOString(),
    models: calibrations,
    sqlUpdates,
    applied,
    notes: [
      'Kolom target adalah models.min_block_override (migrasi 0005).',
      'Override hanya dibuat untuk model dengan isMinBlock=true (charge > formula × 1.5) dan variance <=20%.',
      'Variance dihitung dari stddev raw token (prompt + completion) 3 request; >20% ditandai tidak konsisten.',
      apply
        ? 'Mode --apply: update dijalankan oleh script.'
        : 'Mode dry-run: SQL tidak dijalankan otomatis.',
    ],
  };

  const filePath = writeReportFile(report);
  console.log(`\n💾 Hasil lengkap disimpan ke: ${path.relative(process.cwd(), filePath)}`);

  if (measured.length === 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
