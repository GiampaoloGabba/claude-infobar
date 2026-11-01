import type { EngineInterface } from 'claude-code'

async function comandoApertura($: EngineInterface, path: string): Promise<string[]> {
  if ((await $.env.get('OS')) === 'Windows_NT') return ['explorer.exe', path.replaceAll('/', '\\')]
  const { stdout } = await $.process.run(['uname', '-s'])
  return [stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', path]
}

// Apre l'immagine con il visualizzatore predefinito; explorer.exe esce con 1 anche quando l'ha aperta.
export async function apri($: EngineInterface, path: string) {
  const esito = await comandoApertura($, path)
    .then(argv => $.process.run(argv))
    .catch((errore: unknown) => errore)
  if (esito instanceof Error) $.ui.toast(`Non riesco ad aprire ${path}: ${esito.message}`)
}
