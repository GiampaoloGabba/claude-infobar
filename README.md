# Claude Infobar

Una mod per Claude Code che tiene sopra il prompt le cose che guardo di continuo durante una sessione lunga: modello, branch, quanto contesto resta e se è il momento giusto per compattare.

```
Opus 5.5 medium | mio-progetto (main)
◐ 228.3k 23% ██░░░░░░░░ | compattabile | autonomo | ripresa 00:31 annulla
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

La seconda riga parte dal contesto: token usati, percentuale della finestra e una barra che diventa gialla oltre il 50% e rossa oltre l'80%. Si aggiorna dopo ogni strumento che Claude usa, quindi la vedi salire anche durante un turno lungo. Al 70% e all'85% arriva un avviso.

Subito dopo c'è lo stato della compattazione. `compattabile` vuol dire che non gira niente in background. `attendi: 2 agent, 1 workflow` vuol dire che ci sono subagent, workflow, Monitor o comandi ancora attivi e che compattare adesso rischia di farteli perdere di vista. `turno in corso` è Claude che sta lavorando.

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
