import { expect, mock, test } from 'claude-code/testing'

import { estratto, filtra, primaRiga, unisci } from '../hooks/messaggi'

const m = (id: string, testo: string, ora: number | null = null) => ({ id, testo, ora, risposta: null })

test('la prima riga non vuota, con gli spazi ripetuti ridotti', () => {
  expect(primaRiga('\n\n  guarda   questo\nsecondo')).toBe('guarda questo')
})

test('il filtro vuole tutte le parole, maiuscole o no, e #n cerca il numero', () => {
  const lista = [m('a', 'Fai il COMMIT'), m('b', 'push e commit'), m('c', 'apri il pannello')]
  expect(filtra(lista, '').map(x => x.n)).toEqual([1, 2, 3])
  expect(filtra(lista, 'commit').map(x => x.m.id)).toEqual(['a', 'b'])
  expect(filtra(lista, 'commit push').map(x => x.m.id)).toEqual(['b'])
  expect(filtra(lista, '#3').map(x => x.m.id)).toEqual(['c'])
})

test('la seconda copia di un messaggio appena inviato prende il posto della prima, con l\'ora che ha', () => {
  const unito = unisci([m('a', 'ciao'), m('p', 'prova')], [m('q', 'prova', 1000), m('b', 'altro')], new Map([['q', 'risposta']]))
  expect(unito).toEqual([m('a', 'ciao'), { ...m('q', 'prova', 1000), risposta: 'risposta' }, m('b', 'altro')])
})

function riga(id: string, text: string, kind = 'composer') {
  return {
    plugin: 'infobar',
    component: 'UserMessage',
    surface: 'terminal',
    requestId: id,
    viewport: { columns: 120, rows: 40 },
    props: { text, origin: { kind }, isExpanded: false },
  } as never
}

const PANNELLO = { plugin: 'infobar', component: 'Pane', requestId: 'messaggi', surface: 'terminal', viewport: { columns: 120, rows: 40 }, props: { title: 'Messaggi', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as never

test('il pannello elenca i tuoi messaggi, il più recente in cima, senza le notifiche', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))

  for (const [id, testo, kind] of [
    ['u1', 'primo messaggio\ncon due righe', 'composer'],
    ['n1', 'lavoro finito', 'task-notification'],
    ['u2', 'secondo messaggio', 'composer'],
  ] as const)
    await (await $.ui.mount(riga(id, testo, kind))).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Text', text: 'MESSAGGI · 2' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'msg-n1' })).toBeUndefined()
  const bottoni = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('msg-'))
  expect(bottoni).toEqual(['msg-u2', 'msg-u1'])
})

function blocco(id: string, text: string) {
  return {
    plugin: 'infobar',
    component: 'AssistantMessage',
    surface: 'terminal',
    requestId: id,
    viewport: { columns: 120, rows: 40 },
    props: { text, isFirstOfReply: false },
  } as never
}

test('copia risposta copia l\'ultimo blocco di testo che segue il messaggio', async ($, on) => {
  const clock = mock.clock(on)
  const copiati: string[] = []
  on('ui.copy', ($, e) => (copiati.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))

  for (const r of [riga('u1', 'domanda'), blocco('a1', 'Ora controllo.'), blocco('a2', 'Ecco la risposta.'), riga('u2', 'altra domanda')])
    await (await $.ui.mount(r)).unmount()
  await clock.advance(100)

  const ui = await $.ui.mount(PANNELLO)
  expect(await ui.find({ type: 'Button', key: 'copia-risp-u2' })).toBeUndefined()
  await ui.press({ key: 'copia-risp-u1' })
  await ui.press({ key: 'copia-msg-u2' })
  expect(copiati).toEqual(['Ecco la risposta.', 'altra domanda'])
})

test('cercando, la riga mostra il pezzo intorno alla parola trovata, segnata', () => {
  const testo = 'ciao, devo scrivere un po di storia del progetto e poi controllare il rewind della sessione'
  const lontano = estratto(testo, 'Rewind', 30)
  const riga = lontano.map(p => p.testo).join('')
  expect(riga.startsWith('…')).toBe(true)
  expect(riga.length).toBeLessThanOrEqual(30)
  expect(lontano.filter(p => p.trovato)).toEqual([{ testo: 'rewind', trovato: true }])

  expect(estratto(testo, 'devo', 30)).toEqual([{ testo: 'ciao, ' }, { testo: 'devo', trovato: true }, { testo: ' scrivere un po di …' }])
  expect(estratto('prima riga\nseconda', '', 30)).toEqual([{ testo: 'prima riga' }])
})

test('dopo Invio la parola cercata resta nel campo e la lista filtrata, e azzera riporta tutto', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['riga del motore'] }))
  for (const r of [riga('u1', 'primo'), riga('u2', 'secondo')]) await (await $.ui.mount(r)).unmount()
  await clock.advance(100)

  const ui = (await $.ui.mount(PANNELLO)) as Awaited<ReturnType<typeof $.ui.mount>> & {
    input: (target: { key: string; text: string; kind?: 'change' | 'submit' }) => Promise<unknown>
  }
  const voci = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('msg-'))
  await ui.input({ key: 'cerca-0', text: 'secondo', kind: 'change' })
  await ui.input({ key: 'cerca-0', text: 'secondo' })
  expect(await voci()).toEqual(['msg-u2'])
  expect(await ui.find({ type: 'Text', text: 'MESSAGGI · 1 di 2' })).toBeDefined()
  expect((await ui.find({ type: 'Input', key: 'cerca-1' }))?.props).toMatchObject({ value: 'secondo' })

  await ui.press({ key: 'azzera' })
  expect(await voci()).toEqual(['msg-u2', 'msg-u1'])
})

test('il pulsante della barra apre il pannello, e un secondo clic lo chiude se è quello mostrato', async ($, on) => {
  mock.clock(on)
  const chiamate: string[] = []
  let mostrato = true
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  on('ui.open', ($, e) => (chiamate.push(`open ${e.id}`), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'messaggi', title: 'Messaggi', isShown: mostrato, isFocused: false, isPlaced: true }] }))
  on('ui.close', ($, e) => (chiamate.push(`close ${e.id}`), { value: undefined }))
  on('ui.focus', () => ({}))

  const banda = await $.ui.mount({ plugin: 'infobar', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never })
  await banda.press({ key: 'messaggi' })
  await banda.press({ key: 'messaggi' })
  mostrato = false
  await banda.press({ key: 'messaggi' })
  expect(chiamate).toEqual(['open messaggi', 'close messaggi', 'open messaggi'])
})
