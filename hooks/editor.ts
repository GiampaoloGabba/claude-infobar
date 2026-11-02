import type { EngineInterface } from 'claude-code'

export type Editor = 'rider' | 'code' | 'cursor'

export const NOMI_EDITOR: Record<Editor, string> = { rider: 'Rider', code: 'VS Code', cursor: 'Cursor' }

const DOTNET = /\.(cs|csx|csproj|sln|slnx|props|targets|razor|cshtml|xaml|axaml|fs|fsx|fsproj|vb|vbproj|resx)$/i

type Patch = { newStart?: unknown; lines?: unknown }

/** La prima riga cambiata nel file nuovo, dal primo blocco del diff; 1 per un file creato o senza diff. */
export function rigaModificata(structuredPatch: unknown): number {
  const primo = (Array.isArray(structuredPatch) ? structuredPatch[0] : undefined) as Patch | undefined
  if (typeof primo?.newStart !== 'number') return 1
  let riga = primo.newStart
  for (const linea of Array.isArray(primo.lines) ? primo.lines : []) {
    if (typeof linea !== 'string' || linea.startsWith('+') || linea.startsWith('-')) return riga
    riga++
  }
  return primo.newStart
}

/**
 * Quale editor apre `path`: quello scelto in /config, se no l'IDE in cui gira il terminale, se no Rider per
 * i file .NET e VS Code per il resto, tra quelli installati.
 */
export function scegliEditor(
  path: string,
  opzione: string | undefined,
  env: { terminalEmulator?: string; termProgram?: string },
  installati: readonly Editor[],
): Editor | null {
  if (opzione === 'no') return null
  if (opzione === 'rider' || opzione === 'code' || opzione === 'cursor') return opzione
  if (env.terminalEmulator?.includes('JetBrains') && installati.includes('rider')) return 'rider'
  if (env.termProgram === 'vscode') return installati.includes('cursor') && !installati.includes('code') ? 'cursor' : 'code'
  const preferiti: Editor[] = DOTNET.test(path) ? ['rider', 'code', 'cursor'] : ['code', 'cursor', 'rider']
  return preferiti.find(e => installati.includes(e)) ?? null
}

/**
 * Il comando che apre `path` alla riga `riga` con `eseguibile`, il launcher dell'editor (`code`, o il percorso
 * trovato nel PATH). Su Windows passa da ShellExecute: lanciato direttamente o da cmd.exe l'editor eredita le
 * pipe del comando, e la chiamata resta appesa finché l'editor resta aperto (lo script di Toolbox per Rider fa così).
 */
export function comandoEditor(editor: Editor, eseguibile: string, path: string, riga: number, windows: boolean): string[] {
  const nativo = windows ? path.replaceAll('/', String.fromCharCode(92)) : path
  const argomenti = editor === 'rider' ? ['--line', String(riga), nativo] : ['-g', `${nativo}:${riga}`]
  return windows ? ['rundll32.exe', 'shell32.dll,ShellExec_RunDLL', eseguibile, ...argomenti] : [eseguibile, ...argomenti]
}

let installati: Promise<Map<Editor, string>> | undefined

async function cercaInstallati($: EngineInterface, windows: boolean): Promise<Map<Editor, string>> {
  const trovati = new Map<Editor, string>()
  for (const editor of ['rider', 'code', 'cursor'] as const) {
    const esito = await $.process.run(windows ? ['where.exe', editor] : ['which', editor]).catch(() => null)
    const percorso = esito?.exitCode === 0 ? esito.stdout.split(/\r?\n/)[0]?.trim() : undefined
    if (percorso) trovati.set(editor, percorso)
  }
  return trovati
}

function installatiSu($: EngineInterface, windows: boolean) {
  installati ??= cercaInstallati($, windows)
  return installati
}

type Ambiente = { windows: boolean; terminalEmulator?: string; termProgram?: string }
let ambiente: Promise<Ambiente> | undefined

// Il terminale e il sistema non cambiano durante la sessione: si chiedono una volta, non a ogni riga disegnata.
async function leggiAmbiente($: EngineInterface): Promise<Ambiente> {
  return {
    windows: (await $.env.get('OS')) === 'Windows_NT',
    terminalEmulator: await $.env.get('TERMINAL_EMULATOR'),
    termProgram: await $.env.get('TERM_PROGRAM'),
  }
}

function ambienteDi($: EngineInterface) {
  ambiente ??= leggiAmbiente($)
  return ambiente
}

export async function editorPer($: EngineInterface, path: string, opzione: string | undefined): Promise<Editor | null> {
  if (opzione === 'no') return null
  const env = await ambienteDi($)
  return scegliEditor(path, opzione, env, [...(await installatiSu($, env.windows)).keys()])
}

function argomenti(modello: string): string[] {
  return [...modello.matchAll(/"([^"]*)"|(\S+)/g)].map(m => (m[1] ?? m[2])!)
}

/**
 * Il comando che apre l'output di un lavoro secondo l'opzione `apriOutput`: null per l'editor (il
 * predefinito), `notepad++` per Notepad++ con il monitoraggio del file acceso (segue le righe nuove come
 * tail -f), altrimenti un comando con `{file}` e `{riga}` al posto del percorso e dell'ultima riga.
 */
export function comandoOutput(opzione: string | undefined, file: string, riga: number, windows: boolean): string[] | null {
  const scelta = opzione?.trim() ?? ''
  if (!scelta || scelta === 'editor') return null
  const nativo = windows ? file.replaceAll('/', String.fromCharCode(92)) : file
  const argv =
    scelta === 'notepad++'
      ? ['notepad++.exe', '-monitor', `-n${riga}`, nativo]
      : argomenti(scelta).map(a => a.replaceAll('{file}', nativo).replaceAll('{riga}', String(riga)))
  if (!argv.length) return null
  if (scelta !== 'notepad++' && !scelta.includes('{file}')) argv.push(nativo)
  return windows ? ['rundll32.exe', 'shell32.dll,ShellExec_RunDLL', ...argv] : argv
}

export async function apriInEditor($: EngineInterface, editor: Editor, path: string, riga: number) {
  const { windows } = await ambienteDi($)
  const eseguibile = (await installatiSu($, windows)).get(editor) ?? editor
  const esito = await $.process.run(comandoEditor(editor, eseguibile, path, riga, windows)).catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path} in ${NOMI_EDITOR[editor]}: ${esito.message}`)
  else if (esito && typeof esito === 'object' && 'exitCode' in esito && esito.exitCode !== 0)
    $.ui.toast(`${NOMI_EDITOR[editor]} non è partito (codice ${esito.exitCode}): è nel PATH?`)
}
