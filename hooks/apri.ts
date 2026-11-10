import type { EngineInterface } from 'claude-code'

async function comandoApertura($: EngineInterface, path: string): Promise<string[]> {
  if ((await $.env.get('OS')) === 'Windows_NT') return ['explorer.exe', path.replaceAll('/', '\\')]
  const { stdout } = await $.process.run(['uname', '-s'])
  return [stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', path]
}

// Un file di testo senza un'estensione che il sistema conosca (l'output di un comando, `.output`): su Windows
// explorer chiederebbe con cosa aprirlo, quindi Blocco note, da ShellExecute perché non erediti le pipe e la
// chiamata non resti appesa finché resta aperto; su macOS l'editor di testo predefinito.
export async function apriTesto($: EngineInterface, path: string) {
  let argv: string[]
  if ((await $.env.get('OS')) === 'Windows_NT') argv = ['rundll32.exe', 'shell32.dll,ShellExec_RunDLL', 'notepad.exe', path.replaceAll('/', '\\')]
  else argv = (await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin' ? ['open', '-t', path] : ['xdg-open', path]
  const esito = await $.process.run(argv).catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path}: ${esito.message}`)
}

// Solo dentro un terminale di Mosaic Manager e per le estensioni che la sua Anteprima accetta: gli altri clic
// non devono avviare un processo in più.
export function comandoAnteprimaMosaic(cli: string | undefined, estensioni: string | undefined, path: string): string[] | null {
  if (!cli || !estensioni || !accettataDaMosaic(estensioni, path)) return null
  return [cli, 'preview', path]
}

function accettataDaMosaic(estensioni: string, path: string): boolean {
  const nome = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const punto = nome.lastIndexOf('.')
  if (punto < 0) return false
  const estensione = nome.slice(punto + 1).toLowerCase()
  return !!estensione && estensioni.split(',').some(e => e.trim() === estensione)
}

const MAX_PER_NOTA = 50

// Un Mosaic che non imposta MOSAICMANAGER_PREVIEW_NOTES non conosce --note.
export function comandoNotaMosaic(
  cli: string | undefined,
  note: string | undefined,
  estensioni: string | undefined,
  tipo: 'read' | 'made',
  paths: readonly string[],
): string[] | null {
  if (!cli || !note || !estensioni) return null
  const accettati = paths.filter(path => accettataDaMosaic(estensioni, path)).slice(0, MAX_PER_NOTA)
  return accettati.length ? [cli, 'preview', '--note', tipo, ...accettati] : null
}

// Mai atteso: chi chiama restituisce il risultato del tool senza aspettare Mosaic, e un suo errore non arriva a nessuno.
export function notaMosaic($: EngineInterface, tipo: 'read' | 'made', paths: readonly string[]) {
  if (!paths.length) return
  void (async () => {
    const [cli, note, estensioni] = await Promise.all([
      $.env.get('MOSAICMANAGER_CLI'),
      $.env.get('MOSAICMANAGER_PREVIEW_NOTES'),
      $.env.get('MOSAICMANAGER_PREVIEW'),
    ])
    const argv = comandoNotaMosaic(cli, note, estensioni, tipo, paths)
    if (!argv || !(await $.session.surfaces()).includes('terminal')) return
    await $.process.run(argv, { timeoutMs: 3000 })
  })().catch(() => undefined)
}

async function anteprimaMosaic($: EngineInterface, path: string): Promise<boolean> {
  const argv = comandoAnteprimaMosaic(await $.env.get('MOSAICMANAGER_CLI'), await $.env.get('MOSAICMANAGER_PREVIEW'), path)
  if (!argv) return false
  const esito = await $.process.run(argv, { timeoutMs: 3000 }).catch(() => null)
  return esito?.exitCode === 0
}

// Apre l'immagine con il visualizzatore predefinito; explorer.exe esce con 1 anche quando l'ha aperta.
export async function apri($: EngineInterface, path: string) {
  if (await anteprimaMosaic($, path)) return
  const esito = await comandoApertura($, path)
    .then(argv => $.process.run(argv))
    .catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path}: ${esito.message}`)
}
