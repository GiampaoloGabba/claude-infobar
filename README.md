# Claude Infobar

Una mod per Claude Code che tiene sopra il prompt le cose che guardo di continuo durante una sessione lunga: modello, branch, quanto contesto resta e se è il momento giusto per compattare. Quando incollo un'immagine, sopra la barra ne mostra la miniatura.

```
Opus 5.5 medium | mio-progetto (main)
◐ 228.3k 23% ██░░░░░░░░ ✓ | autonomo | ripresa 00:31 annulla | 5h 20% 2h 40m | 7d 58% 1g 7h | codex 12% 6g
```

L'ho scritta perché passavo metà del tempo a chiedere a Claude "posso compattarti?" e l'altra metà a ripetergli autorizzazioni che gli avevo già dato prima del compact. Gira su Windows, macOS e Linux e non ha bisogno di bash, jq o script esterni.

## Installazione

Dentro Claude Code:

```
/plugin marketplace add GiampaoloGabba/claude-infobar
/plugin install infobar
/reload-plugins
```

Oppure dal terminale:

```bash
claude plugin marketplace add GiampaoloGabba/claude-infobar
claude plugin install infobar@claude-infobar
```

Se hai una statusline che mostra modello, branch e contesto, puoi toglierla: la prima riga della barra fa lo stesso lavoro.

## Cosa si vede

La prima riga ha modello, effort, cartella e branch git (anche dentro un worktree). Il modello è colorato per famiglia, Opus blu, Sonnet arancio, Haiku verde; l'effort va dal verde di `low` al rosso di `max`. All'avvio l'effort viene letto dalle impostazioni (`effortLevel`, o quello del modello in `modelSettings`), poi si aggiorna a ogni turno e con `/effort`. Dopo `/compact`, `/clear` o una ripresa la barra si rilegge subito. Prima della prima risposta il contesto è una stima fatta come `/context` (in una sessione ripresa è il valore esatto), e i limiti di utilizzo sono gli ultimi visti su questo computer, con l'età in fondo (`5h 33% · 2h fa`) finché la prima risposta non porta quelli aggiornati; le finestre già azzerate non compaiono. Se usi Claude anche altrove (altri computer, claude.ai), quei valori grigi possono essere più bassi del reale.

La barra compare solo nel terminale: nell'app desktop non viene disegnata, mentre i comandi continuano a funzionare.

In fondo alla seconda riga ci sono i limiti di utilizzo dell'abbonamento: la finestra di 5 ore, quella settimanale ed eventuali limiti settimanali per modello, ognuno con la percentuale usata e, in grigio, il tempo che manca al reset. La percentuale è la quota del limite già consumata e usa gli stessi colori del contesto: verde sotto il 50%, gialla fino all'80%, rossa oltre. Con una sola finestra (i piani senza limite di 5 ore) l'etichetta `7d` non compare: restano percentuale e reset. Senza abbonamento (chiave API) questa parte non compare.

La seconda riga parte dal contesto: token usati, percentuale della finestra e una barra che diventa gialla oltre il 50% e rossa oltre l'80%. Si aggiorna dopo ogni strumento che Claude usa, quindi la vedi salire anche durante un turno lungo. Al 70% e all'85% arriva un avviso.

Attaccato alla barra c'è lo stato della compattazione, con un simbolo solo. `✓` grigio: non gira niente in background, puoi compattare. `◷ 3` giallo: ci sono 3 lavori ancora attivi (subagent, workflow, Monitor o comandi) e compattare adesso rischia di farteli perdere di vista: aspetta che finiscano prima di `/compact`. `…` grigio: Claude sta lavorando. Un clic su `◷ 3` apre il pannello dei lavori (vedi sotto).

In fondo compaiono le autorizzazioni attive e, se c'è, l'orario della ripresa automatica.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/autorizza [testo]` | Aggiunge un'autorizzazione di sessione. Ci sono scorciatoie per `db`, `prod`, `deploy`, `commit` e `push`. Senza argomenti mostra l'elenco. |
| `/revoca <n\|tutte>` | Toglie un'autorizzazione, o tutte. |
| `/autonomo` | Accende o spegne la modalità autonoma: Claude porta a termine il lavoro concordato senza fermarsi a chiedere conferme. |
| `/lavori` | Apre il pannello dei lavori in background, con output e `ferma`. |
| `/ripresa [annulla]` | Mostra la ripresa automatica programmata, o la annulla. |
| `/account [alias\|numero]` | Apre il pannello degli account di cswap; con un alias o un numero fa lo switch del profilo principale. |

## Autorizzazioni che restano dopo il compact

Quello che dai con `/autorizza` e `/autonomo` finisce nel system prompt a ogni richiesta. Dopo una compattazione è ancora lì, e lo vedono anche i subagent. Dura fino alla fine della sessione o fino a `/revoca`.

Attenzione a `commit` e `push`: valgono come conferma esplicita per tutta la sessione, anche se nel tuo CLAUDE.md hai scritto di chiedere ogni volta. È il motivo per cui esistono, ma è bene saperlo.

## Compattazione

A ogni compattazione, compresa quella automatica, la mod chiede al riassunto di tenere l'obiettivo e i passi che mancano, le decisioni prese e le cose da non fare, lo stato di git, i lavori in background con i loro id e l'eventuale ripresa programmata.

## Ripresa dopo un rate limit

Se un turno si ferma per il limite di utilizzo, la mod programma la ripresa un minuto dopo il reset della finestra e ti lascia un avviso con l'orario. Sugli errori temporanei dell'API (overloaded, server error) riprova dopo 30 secondi. Il messaggio di ripresa chiede anche di rilanciare i subagent caduti per lo stesso errore.

Si ferma dopo 4 tentativi di fila. Se nel frattempo scrivi tu qualcosa, la ripresa si annulla da sola.

## Immagini incollate

Quando incolli un'immagine nel prompt (Alt+V su Windows, Ctrl+V su macOS e Linux, oppure il percorso completo di un file immagine incollato come testo), Claude Code la trasforma in un tag `[Image #1]`. Sopra le due righe della barra compare subito una miniatura per ogni tag, senza dover premere un altro tasto. Le miniature mantengono le proporzioni, si rimpiccioliscono per stare nello spazio disponibile e spariscono quando invii il prompt o cancelli i tag.

Sotto ogni miniatura c'è `1: apri`: il numero è il tasto rapido, fino a 9 (dalla decima in poi l'etichetta è `#10`, senza tasto). Un clic apre l'immagine con il visualizzatore di sistema: `explorer.exe` su Windows, `open` su macOS, `xdg-open` su Linux. Con la banda attiva (ctrl+x e poi tab) fa lo stesso il tasto col numero. Se il file in cache non si trova, al posto della miniatura c'è "nessuna anteprima".

L'opzione `anteprime` (in `/config`, alla voce "Anteprime immagini") sceglie come disegnarle:

| Valore | Cosa mostra |
| --- | --- |
| `auto` | Il predefinito: `immagini` in kitty, Ghostty e WezTerm (fuori da tmux o screen), `blocchi` altrove. |
| `immagini` | L'immagine vera, con il protocollo grafico kitty. Il file lo legge il terminale. |
| `blocchi` | Una miniatura a mezzi blocchi colorati: ogni cella mostra due pixel, `▀` con quello sopra come colore del carattere e quello sotto come sfondo. Funziona in qualunque terminale truecolor. |
| `etichette` | Niente miniatura, solo una riga cliccabile come `1: Image #1   2: Image #2`. I file non vengono letti. |
| `no` | Spente. |

Come si comportano i terminali:

- **kitty, Ghostty, WezTerm**: immagine vera.
- **Windows Terminal**: non supporta il protocollo kitty, quindi `auto` usa i blocchi. La risoluzione è molto bassa (la miniatura più grande è 32x6 celle, cioè 32x12 pixel): basta a distinguere le immagini a colpo d'occhio da colori e disposizione, non a leggere il testo di uno screenshot. Per guardarla davvero c'è `apri`. Windows Terminal supporta Sixel, ma l'API delle mod di Claude Code disegna immagini solo con il protocollo kitty, quindi per ora Sixel non si può usare.
- **iTerm2**: `auto` sceglie i blocchi, perché Claude Code non dice alle mod se il terminale supporta la grafica kitty (lo chiede al terminale e si tiene la risposta) e la mod si fida solo di kitty, Ghostty e WezTerm. Se con `anteprime: immagini` il tuo iTerm2 mostra le immagini vere, tieni quello. Se invece una miniatura mostra solo il testo `[Image #n]`, il terminale non supporta il protocollo kitty: torna a `blocchi` o `etichette`.
- **tmux e screen**: le immagini non passano attraverso il multiplexer, quindi blocchi.

Per i blocchi la mod decodifica il PNG da sola, in TypeScript (le mod non hanno zlib). Uno screenshot normale richiede qualche decina di millisecondi, uno 4K quasi un secondo, una volta sola per ogni incolla. I PNG oltre 4 MiB (il massimo che una mod può leggere) e quelli interlacciati restano senza miniatura a blocchi: compare `[Image #n]`, ma `apri` funziona lo stesso.

Il tag nel prompt non si può rinominare con il nome del file: `[Image #n]` è il modo in cui Claude Code collega l'allegato, e il nome del file si conosce solo quando il prompt viene inviato.

## Link nel transcript

Quando Claude legge un'immagine con `Read` (uno screenshot che ha appena fatto, per esempio), sotto la riga del transcript compare `↗ apri <nome file>` in azzurro: un clic la apre nel visualizzatore di sistema, con il file com'è adesso. Vale sia per la riga raggruppata (`Read 1 file, ran 2 shell commands`), chiusa o aperta, sia per una lettura da sola. Solo nel terminale: l'app desktop le mostra già a modo suo.

Nei terminali che disegnano immagini vere (`anteprime: immagini`, quindi kitty, Ghostty, WezTerm) sopra il link c'è anche il PNG che ha visto Claude. Altrove niente miniatura a blocchi: a quella risoluzione uno screenshot non si legge, e nel transcript occuperebbe solo righe. `anteprime: no` spegne anche il link.

Lo stesso link compare sotto i documenti che Claude produce, e li apre il programma che il sistema associa a quel tipo di file:

- **scritti con `Write` o `Edit`**: `.md`, `.txt`, `.csv`, `.tsv`, `.html`, `.svg`. Il codice no, quello si guarda nell'editor.
- **prodotti da un comando** (Bash o PowerShell, per esempio uno script che genera un report): PDF, Word, Excel, PowerPoint, OpenDocument, `.rtf`, `.epub` e i formati di testo sopra. La mod cerca nel comando i percorsi con quelle estensioni e mostra il link solo se il file esiste ed è stato scritto mentre il comando girava: un `cat` di un PDF vecchio non fa comparire niente. Un file che il comando crea senza nominarlo (come `soffice --convert-to pdf`, che decide da sé il nome) resta senza link, e così i comandi lanciati in background.

Le letture di documenti no: Claude rilegge CLAUDE.md e README di continuo e i link sarebbero solo rumore. Questi link non dipendono da `anteprime`.

Sotto `Write` ed `Edit` di un file di codice il link apre l'editor sulla prima riga cambiata: `↗ Rider Program.cs:42`, `↗ VS Code app.ts:7`. L'opzione `editor` (in `/config`) sceglie quale: `auto`, il predefinito, usa l'IDE in cui gira il terminale (quello integrato di Rider o di VS Code); fuori da un IDE Rider per i file .NET (`.cs`, `.razor`, `.csproj`, `.xaml`, ...) e VS Code per il resto, tra quelli installati. `rider`, `code` e `cursor` lo fissano, `no` toglie il link. L'editor va lanciato da riga di comando (`rider`, `code`, `cursor` nel `PATH`: per Rider lo script di JetBrains Toolbox).

Sotto un comando compaiono anche gli URL del suo output, fino a tre: `↗ apri localhost:5173` dopo l'avvio di un server, `↗ apri PR #42` o `↗ apri nuova PR` dopo un `gh pr create` o un `git push`. Si aprono nel browser predefinito. Gli URL già scritti nel comando non contano, così un `curl` non fa comparire niente. Un comando lanciato in background, come un server di sviluppo, stampa l'indirizzo dopo: la mod guarda il suo file di output per due minuti e il link compare appena arriva.

## Copia

Sotto un blocco di una risposta di Claude c'è una riga grigia con `⧉ copia`, che mette negli appunti il suo testo in markdown, più un pulsante per ogni blocco di codice: `⧉ bash`, `⧉ json`, `⧉ codice` se non ha lingua, numerati (`bash 1`, `bash 2`) solo se due si chiamerebbero uguale. Dopo il clic il pulsante dice `✓ copiato` per due secondi.

La riga c'è sotto i blocchi con del codice, sotto quelli di almeno tre righe e sotto l'ultimo blocco di ogni risposta, anche se è una frase sola (compare appena Claude ha finito). Le frasi brevi tra un tool e l'altro ("Ora controllo la cartella.") restano senza.

Sulla riga di un comando Bash o PowerShell, a destra, c'è `⧉ copia comando`. Copia come `/copy`, quindi funziona anche via SSH dove il terminale accetta OSC 52. L'opzione `copia` su `hover` toglie le righe e mostra i pulsanti a destra dell'ultima riga solo con il puntatore sul messaggio (dove il terminale segue il mouse); `no` li toglie.

## Lavori in background

Un clic sul `◷ 3` della barra, o `/lavori`, apre un pannello con i lavori in background della sessione, in due sezioni. In alto `IN CORSO`: ogni lavoro in una cornice, con l'icona del tipo (`$` comando, `◆` subagent, `⚙` workflow, `◉` Monitor), la descrizione, da quanto gira, la riga di comando e le sue ultime tre righe di output, aggiornate ogni due secondi finché il pannello resta aperto: per un server di sviluppo si vede subito se è partito o se è caduto. Sotto `FINITI`: una riga per lavoro, con `✓`, `✗` se è fallito o `■` se è stato fermato, e da quanto. I finiti restano per dieci minuti.

I pulsanti, in azzurro:

- `▾ output` apre l'output intero (le ultime 40 righe) dentro il pannello, `▴ output` lo richiude; c'è anche sui lavori finiti, finché il file esiste.
- `↗ apri` apre il file dell'output nell'editor (quello dell'opzione `editor`), sull'ultima riga.
- `■ ferma`, in rosso, solo sui lavori in corso: al primo clic diventa `■ ferma? clicca di nuovo` (la richiesta scade dopo qualche secondo), al secondo lo ferma come farebbe Claude con TaskStop. Claude riceve la notifica e ne tiene conto.

Un lavoro che Claude ferma da sé (TaskStop) esce subito dal conto. Uno fermato dall'interfaccia di Claude Code esce al riepilogo di fine turno, perché la mod non ne riceve notizia prima.

La durata parte da quando la mod ha visto il lavoro: per un comando lanciato in background è la partenza; per un workflow o un Monitor, che compaiono solo nel riepilogo di fine turno, può essere un po' dopo.

## Codex

Se usi anche Codex, in fondo alla seconda riga c'è il suo piano: `codex 12% 6g`, la percentuale usata e il tempo al reset, con l'etichetta della finestra (`5h`, `7d`) solo quando il piano ne ha più di una. Il dato è dell'account, quindi comprende anche l'uso fatto da altri computer o dal web.

Lo chiede allo stesso endpoint che usa Codex (`chatgpt.com/backend-api/wham/usage`) con il token di `~/.codex/auth.json`, come fa [CodexBar](https://github.com/steipete/CodexBar): il token si legge e basta, non viene mai rinnovato né riscritto, perché rinnovarlo da qui romperebbe il login di Codex. Una sola sessione di Claude chiede, al massimo ogni 5 minuti: le altre leggono il risultato da un file condiviso nella cartella temporanea. Se il token è scaduto (Codex lo rinnova quando lo usi) o l'endpoint non risponde, il valore viene dall'ultimo file di sessione di Codex, con l'età in fondo. Una finestra già azzerata non compare. L'opzione `codex` su `no` spegne tutto; l'endpoint non è documentato, quindi può cambiare.

## Account (cswap)

Se usi [cswap](https://github.com/realiti4/claude-swap) per tenere più account Claude sullo stesso computer, la prima riga parte dall'account della sessione: `mini ▾` in verde sul profilo principale `~/.claude`, `canevari ⚑` in magenta su un profilo dedicato (`CLAUDE_CONFIG_DIR=~/.claude-canevari`, che ha un login suo e non segue cswap). Il nome è l'alias che gli dai in cswap, letto dai file locali senza chiamare la rete; su un profilo dedicato senza cswap compare il nome della cartella.

Un clic sul nome, o `/account`, apre il pannello: ogni account con i consumi della finestra di 5 ore e di quella settimanale e il reset dopo `↻`, quello attivo sul profilo principale segnato `ATTIVO`, un avviso dove il login va rifatto e un pulsante **switch** sugli altri. Il pannello si aggiorna ogni 5 minuti finché resta aperto (l'endpoint dei consumi di cswap rifiuta le richieste troppo fitte), `r` lo aggiorna subito.

Lo switch cambia solo il profilo principale, quindi c'è solo lì: su un profilo dedicato il pannello mostra i consumi senza pulsanti, mette in evidenza l'account di quell'istanza e `/account <alias>` non cambia niente. Dove la sessione ha un login suo, come nell'app desktop che le passa il proprio token, l'account e `/account` non compaiono: cswap non la riguarda. L'opzione `account` su `no` toglie tutto. Serve cswap 0.27 o successivo, in `~/.local/bin` o nel `PATH`.

## Se la barra sparisce

L'API delle mod di Claude Code è ancora in anteprima e può cambiare da una versione all'altra. Per quel caso c'è [`extras/statusline.sh`](extras/statusline.sh), una statusline classica con le stesse informazioni (serve bash con jq):

```json
{ "statusLine": { "type": "command", "command": "bash /percorso/di/statusline.sh" } }
```

## Sviluppo

```bash
claude plugin validate .
claude plugin test .
```

Per provare una modifica senza reinstallare: `claude --plugin-dir /percorso/di/claude-infobar`.

## Licenza

MIT
