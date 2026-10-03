# Claude Infobar

Una mod per Claude Code che tiene sopra il prompt le cose che guardo di continuo durante una sessione lunga: modello, branch, quanto contesto resta e se è il momento giusto per compattare.

```
Opus 5.5 medium | mio-progetto (main)
◐ 228.3k 23% ██░░░░░░░░ ✓ | autonomo | ripresa 00:31 annulla | 5h 20% 2h 40m | 7d 58% 1g 7h
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

La prima riga ha modello, effort, cartella e branch git (anche dentro un worktree). Il modello è colorato per famiglia, Opus blu, Sonnet arancio, Haiku verde; l'effort va dal verde di `low` al rosso di `max`.

In fondo alla seconda riga ci sono i limiti di utilizzo dell'abbonamento: la finestra di 5 ore, quella settimanale ed eventuali limiti settimanali per modello, ognuno con la percentuale usata e il tempo che manca al reset. La percentuale è la quota del limite già consumata e usa gli stessi colori del contesto: verde sotto il 50%, gialla fino all'80%, rossa oltre. Senza abbonamento (chiave API) questa parte non compare.

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
