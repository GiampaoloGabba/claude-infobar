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

// Apre l'immagine con il visualizzatore predefinito; explorer.exe esce con 1 anche quando l'ha aperta.
export async function apri($: EngineInterface, path: string) {
  const esito = await comandoApertura($, path)
    .then(argv => $.process.run(argv))
    .catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path}: ${esito.message}`)
}
