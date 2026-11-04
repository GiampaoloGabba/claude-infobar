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

I pulsanti della barra che aprono un pannello (il profilo, `✎`, `◷`, `≡`) funzionano da interruttore: il primo clic apre il pannello, un secondo clic lo chiude se è quello in vista, o lo porta davanti se è una scheda dietro un'altra. I comandi (`/modifiche`, `/lavori`, `/messaggi`, `/account`) invece aprono e basta.

I colori di barra e pannelli seguono il tema di Claude Code (`/theme`), anche quelli chiari: giallo, verde e rosso sono le sue chiavi `warning`, `success` ed `error`. Fanno eccezione i nomi dei modelli, i link e `≡`, che hanno colori propri.

Quando una riga intera non ci sta, si compatta un passo alla volta, solo quanto serve. La prima perde i `|`, poi scrive l'effort in due lettere (`lw` `md` `hi` `xh` `mx`, con lo stesso colore) e poi accorcia dal mezzo cartella e branch (non sotto gli 8 caratteri). La seconda perde la barra del contesto (resta la percentuale) e poi i `|`; senza separatori l'etichetta `codex` diventa bianca, così si vede dove cominciano i suoi limiti. Se non basta ancora, va a capo un pezzo intero alla volta, mai una parola a metà.

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
| `/modifiche` | Apre il pannello dei file modificati e non committati nel repository git, con diff. |
| `/messaggi` | Apre il pannello dei tuoi messaggi: cerca, salta a uno nel transcript, copia messaggio e risposta. Si apre anche con `≡` nella barra. Solo nel terminale. |
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

Formati: PNG (anche con trasparenza), JPEG baseline e progressivo (con l'orientamento EXIF delle foto), GIF (il primo fotogramma). Il WebP mostra "WebP: niente anteprima": decodificarlo in TypeScript costerebbe più codice di tutti gli altri formati insieme, ma `apri` funziona.

L'opzione `anteprime` (in `/config`, alla voce "Anteprime immagini") sceglie come disegnarle:

| Valore | Cosa mostra |
| --- | --- |
| `auto` | Il predefinito: `immagini` in kitty, Ghostty e WezTerm (fuori da tmux o screen) e dove è impostata `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`, `blocchi` altrove. |
| `immagini` | L'immagine vera, con il protocollo grafico kitty. La mod la decodifica, la riduce alla misura del riquadro e la passa al terminale come dati, non come percorso: funziona anche via SSH o con il terminale su un altro PC. |
| `blocchi` | Una miniatura a mezzi blocchi colorati: ogni cella mostra due pixel, `▀` con quello sopra come colore del carattere e quello sotto come sfondo. Funziona in qualunque terminale truecolor. |
| `etichette` | Niente miniatura, solo una riga cliccabile come `1: Image #1   2: Image #2`. I file non vengono letti. |
| `no` | Spente. |

Come si comportano i terminali:

- **kitty, Ghostty, WezTerm**: immagine vera.
- **Via SSH**: le variabili da cui la mod riconosce il terminale di solito non arrivano sulla macchina remota, quindi `auto` sceglie i blocchi. Se il terminale da cui ti colleghi disegna la grafica kitty, imposta `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` sulla macchina remota (o scegli `anteprime: immagini`): le miniature viaggiano dentro la connessione.
- **Mosaic Manager**: imposta da sé `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` nei suoi terminali e traduce la grafica kitty in Sixel, quindi `auto` mostra l'immagine vera anche dentro Windows Terminal.
- **Windows Terminal** da solo: non supporta il protocollo kitty, quindi `auto` usa i blocchi. La risoluzione è molto bassa (la miniatura più grande è 32x6 celle, cioè 32x12 pixel): basta a distinguere le immagini a colpo d'occhio da colori e disposizione, non a leggere il testo di uno screenshot. Per guardarla davvero c'è `apri`. Windows Terminal supporta Sixel, ma l'API delle mod di Claude Code disegna immagini solo con il protocollo kitty: per il Sixel serve Mosaic Manager, che fa la traduzione.
- **iTerm2**: `auto` sceglie i blocchi, perché Claude Code non dice alle mod se il terminale supporta la grafica kitty (lo chiede al terminale e si tiene la risposta) e la mod si fida solo di kitty, Ghostty e WezTerm. Se con `anteprime: immagini` il tuo iTerm2 mostra le immagini vere, tieni quello. Se invece una miniatura mostra solo il testo `[Image #n]`, il terminale non supporta il protocollo kitty: torna a `blocchi` o `etichette`.
- **tmux e screen**: le immagini non passano attraverso il multiplexer, quindi blocchi.

La mod decodifica le immagini da sola, in TypeScript (le mod non hanno zlib né moduli nativi), una volta sola per ogni incolla, e non fa aspettare l'incolla: il riquadro compare subito con `…`, la miniatura arriva appena la decodifica, su un timer suo, ha finito, un'immagine alla volta. La miniatura è piccola: al massimo 320x120 pixel con `immagini` (32x6 celle da 10x20 pixel, la misura di una cella di Windows Terminal in Sixel), 64x64 con `blocchi`. Un JPEG si decodifica direttamente a quella scala (a 1/2, 1/4 o 1/8, saltando quasi tutta l'IDCT; in un JPEG progressivo grande anche gran parte dei dati), quindi una foto da 12 megapixel costa meno di uno screenshot PNG: del PNG va decompresso tutto. Uno screenshot 4K in PNG resta il caso più lento.

Restano senza miniatura, con `[Image #n]` al suo posto, i PNG interlacciati e i JPEG aritmetici o danneggiati. Oltre i 4 MiB (il massimo che `$.fs.read` concede a una mod) un PNG con `immagini` lo legge dal percorso kitty, Ghostty o WezTerm in locale. Via SSH, in Mosaic Manager (che per sicurezza non legge file per percorso) e negli altri terminali con le immagini, fino a 32 MiB lo legge un processo figlio (`base64`, su Windows PowerShell) e diventa una miniatura come le altre: un PNG da 26 MB costa un paio di secondi, sempre senza far aspettare l'incolla. Oltre 32 MiB compare "oltre 32 MiB"; se il processo manca, fallisce o non finisce in 10 secondi, e per i JPEG e le GIF, "oltre 4 MiB". `apri` funziona sempre.

Il tag nel prompt non si può rinominare con il nome del file: `[Image #n]` è il modo in cui Claude Code collega l'allegato, e il nome del file si conosce solo quando il prompt viene inviato.

## Link nel transcript

Quando Claude legge un'immagine con `Read`, o la crea con un comando (uno screenshot salvato da PowerShell, un grafico generato da uno script), sotto la riga del transcript compare `↗ <nome file>` in azzurro: un clic la apre nel visualizzatore di sistema, con il file com'è adesso. Un nome lungo si accorcia dal mezzo e tiene l'estensione (`screenshot…43616.png`): sotto un'immagine sta nella larghezza del riquadro, altrove arriva a 40 caratteri. Vale sia per la riga raggruppata (`Read 1 file, ran 2 shell commands`), chiusa o aperta, sia per una lettura da sola. Solo nel terminale: l'app desktop le mostra già a modo suo.

Nei terminali che disegnano immagini vere (`anteprime: immagini`, quindi kitty, Ghostty, WezTerm) sopra il link c'è anche l'immagine: il PNG che ha visto Claude, o la miniatura decodificata dal file per un JPEG, una GIF o un'immagine creata da un comando. Un'immagine creata e poi letta nella stessa riga del transcript ha un link solo. Altrove, di default, solo il link: a mezzi blocchi uno screenshot non si legge, e nel transcript occupa righe. Chi la vuole lo stesso accende l'opzione `miniatureLette` ("Miniature delle immagini lette" in `/config`, `si`): con le anteprime a blocchi sopra il link compare la miniatura colorata di PNG, JPEG e GIF, decodificata su un timer come quelle incollate (prima `…`, poi i blocchi). `anteprime: no` spegne anche il link.

Lo stesso link compare sotto i documenti che Claude produce, e li apre il programma che il sistema associa a quel tipo di file:

- **scritti con `Write` o `Edit`**: `.md`, `.txt`, `.csv`, `.tsv`, `.html`, `.svg`. Il codice no, quello si guarda nell'editor.
- **prodotti da un comando** (Bash o PowerShell, per esempio uno script che genera un report): PDF, Word, Excel, PowerPoint, OpenDocument, `.rtf`, `.epub`, i formati di testo sopra e le immagini (PNG, JPEG, GIF, WebP). La mod cerca i percorsi con quelle estensioni nel comando e nel suo output (dove uno script stampa il nome che ha composto, come `screenshot-20261102-143616.png`; al massimo tre, e non dai comandi che stampano file come `ls` o `Get-ChildItem`), e mostra il link solo se il file esiste ed è stato scritto mentre il comando girava: un `cat` di un PDF vecchio non fa comparire niente. Un file che il comando crea senza nominarlo né stamparlo resta senza link, e così i comandi lanciati in background.

Le letture di documenti no: Claude rilegge CLAUDE.md e README di continuo e i link sarebbero solo rumore. L'eccezione è la risposta di Codex: quando Claude legge un file che si chiama esattamente `last-message.md`, il nome che le skill passano a `codex exec -o`, il link compare, così quello che ha scritto Codex si può sempre leggere. Questi link non dipendono da `anteprime`.

Sotto `Write` ed `Edit` di un file di codice il link apre l'editor sulla prima riga cambiata: `↗ Rider Program.cs:42`, `↗ VS Code app.ts:7`. L'opzione `editor` (in `/config`) sceglie quale: `auto`, il predefinito, usa l'IDE in cui gira il terminale (quello integrato di Rider o di VS Code); fuori da un IDE Rider per i file .NET (`.cs`, `.razor`, `.csproj`, `.xaml`, ...) e VS Code per il resto, tra quelli installati. `rider`, `code` e `cursor` lo fissano, `no` toglie il link. L'editor va lanciato da riga di comando (`rider`, `code`, `cursor` nel `PATH`: per Rider lo script di JetBrains Toolbox).

Sotto un comando compaiono anche gli URL del suo output, fino a tre: `↗ localhost:5173` dopo l'avvio di un server, `↗ PR #42` dopo un `gh pr create`. Si aprono nel browser predefinito. Gli URL già scritti nel comando non contano, così un `curl` non fa comparire niente, e nemmeno il suggerimento "Create a pull request" che git stampa a ogni push. Niente link nemmeno per gli URL che sono nomi e non pagine: schemi e namespace (`json-schema.org`, `w3.org`, `schema.org`, `schemas.microsoft.com`, file `.xsd` e `.dtd`), licenze (`apache.org/licenses`, `opensource.org`) ed `example.com`. Niente URL dai comandi che stampano il contenuto di file (`cat`, `grep`, `rg`, `sed`, `head`, `tail`, `Get-Content`, `Select-String`, `git diff`, `git log`, `git show`, ...): sono indirizzi scritti nel codice o nei log, non creati dal comando. Basta uno di questi in un comando composto (`cd x && grep ...`); in una pipe conta il primo programma, così `git push | tail -2` vale come `git push`. Sotto un gruppo di comandi lo stesso indirizzo compare una volta sola, e un indirizzo che è solo l'inizio del percorso di un altro sparisce: accanto a `github.com/utente/repo` non c'è anche `github.com/utente`. La radice di un server (`localhost:5173`) resta comunque. Un comando lanciato in background, come un server di sviluppo, stampa l'indirizzo dopo: la mod guarda il suo file di output per due minuti e il link compare appena arriva.

## Modifiche compatte

Nel transcript del terminale il diff di `Write` ed `Edit` non occupa più mezzo schermo: sotto la riga del tool resta una riga sola con le righe aggiunte e tolte, `▸ +12 −3  diff`, o `▸ nuovo · 45 righe  contenuto` per un file creato. Un clic sulla riga apre il diff lì dov'è, disegnato da Claude Code come sempre (la freccia diventa `▾` e la scritta `chiudi`), e un altro clic lo richiude. Con ctrl+o (o `--verbose`) i diff sono tutti aperti, senza clic. Il link all'editor (`↗ VS Code app.ts:7`) resta sotto la riga compatta. Le chiamate finite in errore restano come sono.

Lo stesso per le celle dei notebook Jupyter cambiate con `NotebookEdit`: `▸ +4 −2  diff`, `▸ nuova cella · 10 righe` o `▸ cella tolta · 3 righe`.

Lo stesso per i comandi che cambiano file su disco (`git merge`, `git checkout`, `sed -i`, uno script): Claude Code mette sotto l'output una riga `Updated … (+n −m)` per ogni file, e la mod la riduce a `▸ 7 file cambiati  +190 −0  dettagli`. Se l'output ha un `CONFLICT` di git, accanto compare `✗ conflitti` in rosso. Il clic apre output ed elenco come li disegna Claude Code. Gli altri comandi restano come sono.

Un diff aperto ha `▴ chiudi` anche in fondo, così non serve risalire.

Quando Claude Code raggruppa delle chiamate in una riga (`Listed 1 directory, ran 1 shell command`) e una è fallita, sotto la riga compare `⎿ ✗ 1 fallito` in rosso: da sola la riga non lo dice.

Le tue risposte alle domande di Claude (`User answered Claude's questions`) sono riordinate sotto `● Le tue risposte:`: per ogni domanda il titolo, la domanda in grigio e sotto la risposta in grassetto (`→ Sì, ovunque uguale`), con le note che hai aggiunto. Con ctrl+o tornano come le scrive Claude Code. Se invece rifiuti le domande, al posto di `User declined to answer questions` e delle opzioni compare `● Domande rifiutate:` con una riga per domanda, titolo e domanda in grigio.

L'opzione `modificheCompatte` ("Modifiche compatte" in `/config`) spegne con `no` i diff compatti; l'avviso dei falliti e le risposte e le domande rifiutate restano riordinate. Solo nel terminale: l'app desktop ha già i suoi blocchi espandibili.

## Messaggi

Il pannello `Messaggi` (`/messaggi`, o `≡ 12`, l'ultima voce della seconda riga della barra, con il numero dei messaggi) elenca i tuoi messaggi della sessione, il più recente in cima, con numero, ora d'invio e prima riga. Un clic porta il transcript a quel messaggio, in cima allo schermo, e il messaggio si accende per un attimo, così si trova anche se era già a video. Il campo in alto, che prende la tastiera appena il pannello si apre, filtra mentre scrivi: tutte le parole, maiuscole o no; `#12` cerca per numero. `Invio` porta la tastiera sul primo risultato, come in una palette: con le frecce scegli, con `Invio` salti, con `Esc` torni al prompt. La parola cercata resta nel campo; in cima il conto dice quanti ne trova (`MESSAGGI · 3 di 10`) e `✕ azzera` riporta tutta la lista e rimette la tastiera nel campo. Mentre cerchi, ogni riga mostra il pezzo del messaggio dove compare la parola, segnata in giallo, e non il suo inizio: anche in un messaggio lungo si vede subito perché è stato trovato. Con il puntatore su un messaggio compaiono, in fondo alla sua riga, `⧉ testo`, che lo copia, e `⧉ risposta`, che copia l'ultimo blocco della risposta di Claude. Solo nel terminale: nell'app desktop il pannello e il comando non ci sono. Le notifiche dei lavori in background e i messaggi di altri agenti non ci sono.

La mod raccoglie i messaggi man mano che il terminale li disegna: in una sessione ripresa compaiono quelli già mostrati, e l'ora c'è solo per quelli inviati in questa sessione.

## Copia

Sotto un blocco di una risposta di Claude c'è una riga grigia con `⧉ copia`, che mette negli appunti il suo testo in markdown, più un pulsante per ogni blocco di codice: `⧉ bash`, `⧉ json`, `⧉ codice` se non ha lingua, numerati (`bash 1`, `bash 2`) solo se due si chiamerebbero uguale, e uno per ogni tabella, `⧉ tabella` (o `tabella 1`, `tabella 2`), che copia il suo markdown: incollata in un documento, in Jira o in un README resta una tabella. Le tabelle dentro un blocco di codice no, quelle si copiano con il blocco. Dopo il clic il pulsante dice `✓ copiato` per due secondi.

La riga completa c'è sotto l'ultimo blocco di ogni risposta, anche se è una frase sola (compare appena Claude ha finito). Sotto i blocchi a metà lavoro, tra un tool e l'altro, compaiono solo i pulsanti di codice e tabelle, se ce ne sono: il testo non lo copia nessuno, e senza codice né tabelle la riga non c'è.

Sulla riga di un comando Bash o PowerShell, a destra, c'è `⧉ copia comando`. Copia come `/copy`, quindi funziona anche via SSH dove il terminale accetta OSC 52. L'opzione `copia` su `hover` toglie le righe e mostra i pulsanti a destra dell'ultima riga solo con il puntatore sul messaggio (dove il terminale segue il mouse); `no` li toglie.

## Lavori in background

Un clic sul `◷ 3` della barra, o `/lavori`, apre un pannello con i lavori in background della sessione, in due sezioni. In alto `IN CORSO`: ogni lavoro in una cornice, con l'icona del tipo (`$` comando, `◆` subagent, `⚙` workflow, `◉` Monitor), la descrizione, da quanto gira, la riga di comando e le sue ultime tre righe di output, aggiornate ogni due secondi finché il pannello resta aperto: per un server di sviluppo si vede subito se è partito o se è caduto. Sotto `FINITI`: una riga per lavoro, con `✓` verde, `✗ … · fallito` o `■ … · fermato`, e da quanto, con i pulsanti allineati a destra; un `✓` grigio è un lavoro sparito senza che si sappia come è finito. I finiti restano per dieci minuti.

Un comando avviato da un subagent ha sotto il titolo `↳ da ◆ <subagent>`, il subagent che l'ha lanciato. Il watch che Claude Code apre da sé su un artifact pubblicato (`live updates for artifact …`) non è un lavoro: non compare né nel pannello né nel conto.

I pulsanti:

- `▾ output` apre l'output intero (le ultime 40 righe) dentro il pannello; aperto, il pulsante diventa `▴ chiudi output` a colori invertiti e lo richiude, come la `✕` in alto a destra nel riquadro; c'è anche sui lavori finiti, finché il file esiste.
- `↗ apri` apre il file dell'output nell'editor (quello dell'opzione `editor`), sull'ultima riga. L'opzione `apriOutput` ("Apri output con" in `/config`) lo cambia: `notepad++` lo apre in Notepad++ con il monitoraggio del file acceso, che segue le righe nuove come `tail -f`; un comando tuo, con `{file}` e `{riga}` al posto del percorso e dell'ultima riga (senza `{file}` il percorso va in fondo), apre con qualunque altro programma.
- `■ ferma`, in rosso, solo sui lavori in corso: al primo clic diventa `■ ferma? clicca di nuovo` (la richiesta scade dopo qualche secondo), al secondo lo ferma come farebbe Claude con TaskStop. Claude riceve la notifica e ne tiene conto.

Un lavoro che Claude ferma da sé (TaskStop) esce subito dal conto. Uno fermato dall'interfaccia di Claude Code esce al riepilogo di fine turno, perché la mod non ne riceve notizia prima.

Il pannello rilegge un file di output solo quando cambia. Oltre i 4 MB, il massimo che una mod può leggere, al posto delle ultime righe compare la dimensione: il file si guarda con `↗ apri`.

La durata parte da quando la mod ha visto il lavoro: per un comando lanciato in background è la partenza; per un workflow o un Monitor, che compaiono solo nel riepilogo di fine turno, può essere un po' dopo.

## File modificati

Se la sessione lavora dentro un repository git, nella prima riga della barra, dopo il branch, compare `✎ 4` in giallo: i file con modifiche non committate (`mio-progetto (main) ✎ 4`). Un clic, o `/modifiche`, apre il pannello: un file per riga con `+` se è nuovo, `~` se è modificato, `−` se è eliminato, `→` se è rinominato (con il nome di prima) e `!` se è in conflitto, il percorso dalla radice del repository e le righe aggiunte e tolte rispetto all'ultimo commit; in cima il totale.

`▾ diff` mostra il diff del file dentro il pannello, colorato come quelli di Claude Code (le prime 300 righe); `↗ Rider` o `↗ VS Code` (l'editor dell'opzione `editor`) lo apre sulla prima riga cambiata.

L'elenco viene da `git status` e `git diff --numstat`, quindi comprende tutto quello che non è committato: le modifiche di Claude, quelle dei comandi che ha lanciato (formatter, script) e le tue. Si rilegge dopo ogni tool di Claude che può scrivere file, quando invii un prompt e ogni 5 secondi a pannello aperto; git gira senza lock opzionali, così non intralcia un commit in corso. I file in `.gitignore` non ci sono, perché git status non li mostra. Tra i file del tree non ci sono i repository annidati, come i worktree che Claude Code crea per i subagent isolati (`.claude/worktrees/agent-…`): git li elenca come una cartella sola, senza guardarci dentro, e non sono modifiche da committare. Fuori da un repository `✎` non compare e il pannello lo dice.

I file che ha toccato la sessione stanno in cima, sotto `questa sessione · n`, e gli altri seguono sotto `altri · n`; senza file della sessione l'elenco non ha intestazioni. Contano le `Write`, le `Edit` e le `NotebookEdit`, anche dei subagent, e i file che git vede cambiare mentre gira un comando di Bash o PowerShell (un formatter, un generatore, un `git mv`). Per i comandi è un confronto tra due letture di `git status` che la mod fa comunque, senza comandi git in più: un file che modifichi tu mentre il comando gira finisce nella sessione, e uno già modificato che il comando cambia senza spostare il numero di righe aggiunte e tolte resta tra gli altri. Una sessione ripresa ritrova le `Write` e le `Edit` della conversazione principale nel transcript, letto una volta alla prima apertura del pannello; quelle dei subagent e i comandi di prima della ripresa no.

Sotto i file del tree della sessione il pannello mostra gli altri worktree dello stesso repository, ovunque si trovino: quelli dei subagent isolati, quelli che un agente crea accanto con `git worktree add`, i tuoi. La sessione resta nel suo tree mentre l'agente lavora altrove, e senza questa sezione quel lavoro non si vedrebbe. Ogni worktree ha un'intestazione con branch e cartella, i suoi file con `▾ diff` e `↗ apri`, e una riga con i commit che il branch della sessione non ha (`2 commit non nel branch corrente`). Quelli senza file da committare e senza commit nuovi non compaiono. La ricerca vale anche qui. `✎` nella barra conta solo il tree della sessione: gli altri non si possono committare da qui. Questi worktree si leggono solo a pannello aperto.

Da 8 file in su il pannello ha un campo di ricerca, che prende la tastiera appena si apre: filtra per percorso mentre scrivi (tutte le parole, maiuscole o no, anche nel nome di prima di un file rinominato) e segna in giallo il pezzo trovato. `Invio` porta la tastiera sul primo file, `✕ azzera` riporta tutti i file e rimette la tastiera nel campo. Il totale `+120 −45` in cima resta quello di tutti i file.

## Codex

Se usi anche Codex, in fondo alla seconda riga c'è il suo piano: `codex 12% 6g`, la percentuale usata e il tempo al reset, con l'etichetta della finestra (`5h`, `7d`) solo quando il piano ne ha più di una. Il dato è dell'account, quindi comprende anche l'uso fatto da altri computer o dal web.

Lo chiede allo stesso endpoint che usa Codex (`chatgpt.com/backend-api/wham/usage`) con il token di `~/.codex/auth.json`, come fa [CodexBar](https://github.com/steipete/CodexBar): il token si legge e basta, non viene mai rinnovato né riscritto, perché rinnovarlo da qui romperebbe il login di Codex. Una sola sessione di Claude chiede, al massimo ogni 5 minuti: le altre leggono il risultato da un file condiviso nella cartella temporanea. Se il token è scaduto (Codex lo rinnova quando lo usi) o l'endpoint non risponde, il valore viene dall'ultimo file di sessione di Codex, con l'età in fondo. Una finestra già azzerata non compare. L'opzione `codex` su `no` spegne tutto; l'endpoint non è documentato, quindi può cambiare.

## Account (cswap)

Se usi [cswap](https://github.com/realiti4/claude-swap) per tenere più account Claude sullo stesso computer, la prima riga parte dall'account della sessione: `mini ▾` in verde sul profilo principale `~/.claude`, `canevari ⚑` in magenta su un profilo dedicato (`CLAUDE_CONFIG_DIR=~/.claude-canevari`, che ha un login suo e non segue cswap). Il nome è l'alias che gli dai in cswap, letto dai file locali senza chiamare la rete; su un profilo dedicato senza cswap compare il nome della cartella.

Un clic sul nome, o `/account`, apre il pannello: ogni account con i consumi della finestra di 5 ore e di quella settimanale e il reset dopo `↻`, quello attivo sul profilo principale segnato `ATTIVO`, un avviso dove il login va rifatto e un pulsante **switch** sugli altri. Il pannello si aggiorna ogni 5 minuti finché resta aperto (l'endpoint dei consumi di cswap rifiuta le richieste troppo fitte), `↻ aggiorna` lo aggiorna subito.

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
