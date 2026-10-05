# Claude Infobar

Una mod per Claude Code che tiene sopra il prompt le cose che guardo di continuo durante una sessione lunga: modello, branch, quanto contesto resta e se è il momento giusto per compattare. Quando incollo un'immagine, sopra la barra ne mostra la miniatura.

```
Opus 5.5 medium | mio-progetto (main)
◐ 228.3k 23% ██░░░░░░░░ ✓ | autonomo | ripresa 00:31 annulla | 5h 20% ↻ 2h 40m | 7d 58% ↻ 1g 7h
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

La prima riga ha modello, effort, cartella e branch git (anche dentro un worktree). Il modello è colorato per famiglia, Opus blu, Sonnet arancio, Haiku verde; l'effort va dal verde di `low` al rosso di `max`. All'avvio l'effort viene letto dalle impostazioni (`effortLevel`, o quello del modello in `modelSettings`), poi si aggiorna a ogni turno e con `/effort`. Dopo `/compact`, `/clear` o una ripresa la barra si rilegge subito. Prima della prima risposta il contesto è una stima fatta come `/context` (in una sessione ripresa è il valore esatto), e i limiti di utilizzo sono gli ultimi visti su questo computer, in grigio e con l'età (`5h 33% · 2h fa`) finché la prima risposta non porta quelli aggiornati; le finestre già azzerate non compaiono. Se usi Claude anche altrove (altri computer, claude.ai), quei valori grigi possono essere più bassi del reale.

La barra compare solo nel terminale: nell'app desktop non viene disegnata, mentre i comandi continuano a funzionare.

In fondo alla seconda riga ci sono i limiti di utilizzo dell'abbonamento: la finestra di 5 ore, quella settimanale ed eventuali limiti settimanali per modello, ognuno con la percentuale usata e, dopo `↻`, il tempo che manca al reset. La percentuale è la quota del limite già consumata e usa gli stessi colori del contesto: verde sotto il 50%, gialla fino all'80%, rossa oltre. Senza abbonamento (chiave API) questa parte non compare.

La seconda riga parte dal contesto: token usati, percentuale della finestra e una barra che diventa gialla oltre il 50% e rossa oltre l'80%. Si aggiorna dopo ogni strumento che Claude usa, quindi la vedi salire anche durante un turno lungo. Al 70% e all'85% arriva un avviso.

Attaccato alla barra c'è lo stato della compattazione, con un simbolo solo. `✓` grigio: non gira niente in background, puoi compattare. `◷ 3` giallo: ci sono 3 lavori ancora attivi (subagent, workflow, Monitor o comandi) e compattare adesso rischia di farteli perdere di vista; `/compatta` ti dice quali sono. `…` grigio: Claude sta lavorando.

In fondo compaiono le autorizzazioni attive e, se c'è, l'orario della ripresa automatica.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/compatta [forza] [istruzioni]` | Compatta solo se non c'è niente in corso. Con `forza` compatta comunque. |
| `/autorizza [testo]` | Aggiunge un'autorizzazione di sessione. Ci sono scorciatoie per `db`, `prod`, `deploy`, `commit` e `push`. Senza argomenti mostra l'elenco. |
| `/revoca <n\|tutte>` | Toglie un'autorizzazione, o tutte. |
| `/autonomo` | Accende o spegne la modalità autonoma: Claude porta a termine il lavoro concordato senza fermarsi a chiedere conferme. |
| `/ripresa [annulla]` | Mostra la ripresa automatica programmata, o la annulla. |

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
