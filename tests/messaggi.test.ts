import { expect, mock, test } from 'claude-code/testing'

import { filtra, primaRiga, unisci } from '../hooks/messaggi'

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
