import { CARD_BY_ID, SETS, SET_BY_ID, RARITIES, FINISHES } from './data.mjs';
import {
  createState, slotCount, collectionProgress, packPrice, buyPacks,
  tearPack, revealNext, finishPack, equipCard, moveDisplay, sellCard, sellSpare, sellAllSpares,
  buyUpgrade, advance,
} from './engine.mjs';
import { renderGame, updateCounters, showToast, showOffline, formatMoney, setRelationshipFocus } from './view.mjs';
import { animateTear, anticipateReveal, revealImpact } from './animation.mjs';

const SAVE_KEY = 'rip-shop_v1';
const OFFLINE_LIMIT = 4 * 60 * 60;
const TICK_MS = 150;
const SAVE_INTERVAL_MS = 2000;
const AUTO_STEP_SECONDS = 1.5;
const NOTES = { common: [330], uncommon: [440, 554], rare: [523, 659, 784], mythic: [523, 659, 784, 1047] };

/** @typedef {ReturnType<typeof createState>} ShopState */
/** @typedef {{tab:string,filter:string,rarity:string,search:string,selectedKey:string|null,selectedSlot:number|null,lastReveal:object|null,modal:string|null,offline:{amount:number,seconds:number}|null,saveError:boolean}} InterfaceState */

/** @type {InterfaceState} */
const ui = { tab: 'shop', filter: 'all', rarity: 'all', search: '', selectedKey: null, selectedSlot: null, lastReveal: null, modal: null, offline: null, saveError: false };
let state = createState();
let lastTick = performance.now();
let lastSave = lastTick;
let autoClock = 0;
let stageBusy = false;
/** @type {AudioContext|null} */
let audio = null;

/** @param {string} selector @returns {HTMLElement|null} */
function element(selector) { return document.querySelector(selector); }

/** @param {unknown} value @returns {boolean} */
function isSavedShop(value) {
  if (!value || typeof value !== 'object') return false;
  const saved = /** @type {ShopState} */ (value);
  return saved.version === 1 && Number.isFinite(saved.cash) && saved.cash >= 0
    && Number.isFinite(saved.lifetimeCash) && Number.isFinite(saved.savedAt)
    && saved.inventory && saved.seen && Array.isArray(saved.display) && saved.display.length === 6
    && saved.upgrades && saved.settings && saved.stats && Array.isArray(saved.queue)
    && !!SET_BY_ID[saved.selectedSet];
}

/** @returns {void} */
function loadShop() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return;
    const saved = JSON.parse(serialized);
    if (!isSavedShop(saved)) throw new Error('The saved shop has an unsupported format.');
    state = saved;
    const seconds = Math.min(OFFLINE_LIMIT, Math.max(0, (Date.now() - state.savedAt) / 1000));
    const amount = advance(state, seconds);
    if (seconds >= 30) ui.offline = { amount, seconds };
  } catch (error) {
    console.warn('Could not restore the saved shop.', error);
    ui.saveError = true;
  }
}

/** @returns {void} */
function saveShop() {
  state.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    ui.saveError = false;
  } catch (error) {
    if (!ui.saveError) console.warn('Could not save the shop on this device.', error);
    ui.saveError = true;
  }
  lastSave = performance.now();
  const status = element('#saveStatus');
  if (status) status.textContent = ui.saveError ? 'Saving unavailable' : 'Saved on this device';
}

/** @returns {void} */
function draw() {
  const search = document.activeElement instanceof HTMLInputElement && document.activeElement.id === 'collectionSearch';
  const selection = search ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  renderGame(state, ui);
  if (search) {
    const input = document.querySelector('#collectionSearch');
    if (input instanceof HTMLInputElement) {
      input.focus({ preventScroll: true });
      if (selection) input.setSelectionRange(selection[0], selection[1]);
    }
  }
}

/** @returns {void} */
function commit() { saveShop(); draw(); }

/** @param {string} message @returns {void} */
function announce(message) {
  const region = element('#announcer');
  if (region) region.textContent = message;
}

/** @returns {void} */
function startAudio() {
  if (!state.settings.sound || !window.AudioContext) return;
  if (!audio) audio = new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(reportAudioError);
}

/** @param {unknown} error @returns {void} */
function reportAudioError(error) { console.warn('Sound could not start.', error); }

/** @param {number} frequency @param {number} delay @param {number} duration @returns {void} */
function playTone(frequency, delay, duration) {
  if (!audio || !state.settings.sound) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  const time = audio.currentTime + delay;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.07, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(time); oscillator.stop(time + duration);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}

/** @returns {void} */
function playTear() {
  if (!audio || !state.settings.sound) return;
  const duration = 0.16;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
  const source = audio.createBufferSource(), gain = audio.createGain();
  source.buffer = buffer; gain.gain.value = 0.12;
  source.connect(gain); gain.connect(audio.destination);
  source.start();
  source.onended = () => { source.disconnect(); gain.disconnect(); };
}

/** @param {{cardId:string,finish:string,isNew:boolean,isNewFinish:boolean,newSetCompleted:string|null}} result @returns {void} */
function celebrateReveal(result) {
  const card = CARD_BY_ID[result.cardId];
  const notes = NOTES[card.rarity];
  notes.forEach((note, index) => playTone(note * (result.finish === 'prismatic' ? 1.5 : 1), index * 0.065, 0.26));
  announce(`${result.isNew ? 'New discovery. ' : ''}${FINISHES[result.finish].name} ${card.name}. ${card.description}`);
  if (result.newSetCompleted) showToast(`${SET_BY_ID[result.newSetCompleted].name} complete! Every pack now includes a bonus card.`);
}

/** @returns {Promise<boolean>} */
async function ripPack() {
  if (stageBusy || !state.queue[0] || !tearPack(state)) return false;
  stageBusy = true;
  document.body.classList.add('opening');
  saveShop();
  playTone(130, 0, 0.15);
  playTear();
  try {
    const stage = element('#packStage');
    if (stage) await animateTear(stage, state.queue[0].cards.length, state.settings.fastReveal);
  } finally {
    stageBusy = false;
    document.body.classList.remove('opening');
    draw();
  }
  announce('Wrapper torn. Reveal your cards, left to right.');
  return true;
}

/** @param {boolean} automated @returns {Promise<boolean>} */
async function revealCard(automated = false) {
  const pack = state.queue[0];
  if (stageBusy || !pack?.torn || pack.revealed >= pack.cards.length) return false;
  const index = pack.revealed, finalCard = index === pack.cards.length - 1;
  stageBusy = true;
  document.body.classList.add('opening');
  try {
    const stage = element('#packStage');
    const back = stage?.querySelector('.reveal-row')?.children[index];
    back?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    if (finalCard) { playTone(350, 0, 0.1); playTone(465, 0.22, 0.15); }
    if (stage) await anticipateReveal(stage, index, finalCard, state.settings.fastReveal);
    const result = revealNext(state);
    if (!result) return false;
    ui.lastReveal = result;
    const card = CARD_BY_ID[result.cardId];
    if (automated && (card.rarity === 'mythic' || result.finish === 'prismatic' || (result.isNew && RARITIES[card.rarity].rank >= 2))) {
      state.settings.auto = false;
      showToast(`Your opener found ${card.name} and paused. Turn Auto back on when you're ready.`);
    }
    commit();
    celebrateReveal(result);
    const currentStage = element('#packStage');
    currentStage?.querySelector('.reveal-row')?.children[index]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    if (currentStage) await revealImpact(currentStage, index, { rarity: card.rarity, finish: result.finish, fast: state.settings.fastReveal });
    return true;
  } finally {
    stageBusy = false;
    document.body.classList.remove('opening');
  }
}

/** @param {HTMLElement} control @returns {Promise<void>} */
async function performAction(control) {
  const action = control.dataset.action;
  switch (action) {
    case 'buy-pack': {
      const setId = control.dataset.set || state.selectedSet;
      buyPacks(state, setId, Number(control.dataset.quantity || 1));
      state.selectedSet = setId;
      ui.lastReveal = null;
      ui.tab = 'shop';
      playTone(260, 0, 0.12);
      commit();
      break;
    }
    case 'select-set':
      if (state.lifetimeCash < SET_BY_ID[control.dataset.set].unlockAt) {
        showToast(`Earn ${formatMoney(SET_BY_ID[control.dataset.set].unlockAt)} in total to unlock this set.`);
        break;
      }
      state.selectedSet = control.dataset.set;
      commit();
      break;
    case 'tear':
      await ripPack();
      break;
    case 'reveal':
      await revealCard();
      break;
    case 'finish-pack':
      if (finishPack(state)) { ui.lastReveal = null; commit(); }
      break;
    case 'equip':
      ui.selectedKey = ui.selectedKey === control.dataset.key ? null : control.dataset.key;
      ui.selectedSlot = null;
      draw();
      if (ui.selectedKey) announce('Choose an unlocked display slot to place this card.');
      break;
    case 'slot': {
      const index = Number(control.dataset.index);
      if (index >= slotCount(state)) { showToast('Buy another display slot in the shop to use this space.'); break; }
      if (ui.selectedKey) {
        equipCard(state, ui.selectedKey, index);
        ui.selectedKey = null;
        ui.selectedSlot = null;
        playTone(520, 0, 0.12);
        commit();
      } else if (ui.selectedSlot !== null) {
        if (ui.selectedSlot !== index) moveDisplay(state, ui.selectedSlot, index);
        ui.selectedSlot = null;
        commit();
      } else if (state.display[index]) {
        ui.selectedSlot = index;
        draw();
      } else {
        ui.tab = 'collection';
        draw();
        showToast('Choose Display on an owned card, then click this slot.');
      }
      break;
    }
    case 'clear-slot':
      equipCard(state, null, Number(control.dataset.index));
      ui.selectedSlot = null;
      commit();
      break;
    case 'sell-one': {
      const key = control.dataset.key;
      const sale = sellCard(state, key, 1);
      if (!state.inventory[key]) ui.selectedKey = null;
      showToast(`Sold one card for ${formatMoney(sale.amount)}. Its album discovery stays forever.`);
      playTone(740, 0, 0.12);
      commit();
      break;
    }
    case 'sell': {
      const sale = sellSpare(state, control.dataset.key);
      showToast(sale.quantity ? `Sold ${sale.quantity} spare${sale.quantity === 1 ? '' : 's'} for ${formatMoney(sale.amount)}. Your collection is kept.` : 'No spares to sell. Your last copy and displayed cards are protected.');
      if (sale.quantity) playTone(740, 0, 0.12);
      commit();
      break;
    }
    case 'sell-all': {
      const amount = sellAllSpares(state);
      showToast(amount ? `Sold spares for ${formatMoney(amount)}. Kept every last copy and displayed card.` : 'No spare copies yet. Keep ripping!');
      commit();
      break;
    }
    case 'upgrade': {
      const wasMastered = collectionProgress(state).mastered;
      buyUpgrade(state, control.dataset.upgrade);
      playTone(660, 0, 0.16);
      commit();
      if (!wasMastered && collectionProgress(state).mastered) showToast('Master Collector! All 24 cards discovered and the full display unlocked.');
      break;
    }
    case 'tab':
      ui.tab = control.dataset.tab;
      draw();
      break;
    case 'filter':
      ui.filter = control.dataset.filter;
      draw();
      break;
    case 'rarity':
      ui.rarity = control.dataset.rarity;
      draw();
      break;
    case 'help': ui.modal = 'help'; draw(); break;
    case 'settings': ui.modal = 'settings'; draw(); break;
    case 'close-modal': ui.modal = null; draw(); break;
    case 'toggle-sound':
      state.settings.sound = !state.settings.sound;
      if (state.settings.sound) startAudio();
      commit();
      break;
    case 'toggle-auto':
      if (!state.upgrades.opener) { showToast('Hire an opener in the upgrades shop first.'); break; }
      state.settings.auto = !state.settings.auto;
      autoClock = 0;
      commit();
      break;
    case 'toggle-fast':
      state.settings.fastReveal = !state.settings.fastReveal;
      commit();
      break;
    case 'dismiss-offline':
      ui.offline = null;
      draw();
      break;
  }
}

/** @param {Event} event @returns {Promise<void>} */
async function onClick(event) {
  if (stageBusy || !(event.target instanceof Element)) return;
  const control = event.target.closest('[data-action]');
  if (!(control instanceof HTMLElement) || control instanceof HTMLButtonElement && control.disabled) return;
  startAudio();
  try { await performAction(control); }
  catch (error) {
    if (error instanceof Error) showToast(error.message);
    else { console.error('The shop action failed.', error); showToast('That action could not be completed.'); }
  }
}

/** @param {Event} event @returns {void} */
function onInput(event) {
  if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'collectionSearch') return;
  ui.search = event.target.value;
  draw();
}

/** @param {KeyboardEvent} event @returns {Promise<void>} */
async function onKeyDown(event) {
  if (stageBusy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'Escape') {
    ui.modal = null; ui.selectedKey = null; ui.selectedSlot = null; draw();
    return;
  }
  if (event.code !== 'Space' || event.repeat || ui.modal) return;
  if (event.target instanceof HTMLButtonElement) return;
  event.preventDefault();
  startAudio();
  const pack = state.queue[0];
  const action = !pack ? 'buy-pack' : !pack.torn ? 'tear' : pack.revealed < pack.cards.length ? 'reveal' : 'finish-pack';
  const control = document.createElement('button');
  control.dataset.action = action;
  try { await performAction(control); }
  catch (error) { if (error instanceof Error) showToast(error.message); else console.error(error); }
}

/** @param {Event} event @returns {void} */
function onRelationOver(event) {
  if (!(event.target instanceof Element)) return;
  const slot = event.target.closest('[data-display-slot]');
  if (slot instanceof HTMLElement) setRelationshipFocus(state, Number(slot.dataset.displaySlot));
}

/** @param {MouseEvent} event @returns {void} */
function onRelationOut(event) {
  if (!(event.target instanceof Element)) return;
  const from = event.target.closest('[data-display-slot]');
  const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-display-slot]') : null;
  if (from && from !== to) setRelationshipFocus(state, to instanceof HTMLElement ? Number(to.dataset.displaySlot) : ui.selectedSlot);
}

/** @param {FocusEvent} event @returns {void} */
function onRelationBlur(event) {
  if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-display-slot]')) setRelationshipFocus(state, ui.selectedSlot);
}

/** @type {{startX:number,pointerId:number,seal:HTMLElement}|null} */
let drag = null;

/** @param {PointerEvent} event @returns {void} */
function onSealDown(event) {
  if (stageBusy || !(event.target instanceof Element)) return;
  const seal = event.target.closest('#packSeal');
  if (!(seal instanceof HTMLElement) || !state.queue[0] || state.queue[0].torn) return;
  drag = { startX: event.clientX, pointerId: event.pointerId, seal };
  seal.setPointerCapture(event.pointerId);
  seal.classList.add('tearing');
  seal.closest('#sealedPack')?.classList.add('is-pulled');
  startAudio();
}

/** @param {PointerEvent} event @returns {void} */
function onSealMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = Math.abs(event.clientX - drag.startX);
  drag.seal.style.setProperty('--tear-progress', String(Math.min(1, distance / 90)));
  drag.seal.closest('#sealedPack')?.style.setProperty('--pull', String(Math.min(1, distance / 90)));
  if (distance < Math.min(90, drag.seal.clientWidth * 0.65)) return;
  endSealDrag();
  ripPack().catch(reportAutomaticError);
}

/** @returns {void} */
function endSealDrag() {
  if (!drag) return;
  if (drag.seal.hasPointerCapture(drag.pointerId)) drag.seal.releasePointerCapture(drag.pointerId);
  drag.seal.classList.remove('tearing');
  drag.seal.style.removeProperty('--tear-progress');
  drag.seal.closest('#sealedPack')?.classList.remove('is-pulled');
  drag.seal.closest('#sealedPack')?.style.removeProperty('--pull');
  drag = null;
}

/** @returns {Promise<boolean>} */
async function autoStep() {
  if (stageBusy || !state.settings.auto || !state.upgrades.opener || document.hidden || ui.modal) return false;
  const pack = state.queue[0];
  if (!pack) {
    if (state.cash < packPrice(state, state.selectedSet, 1)) return false;
    buyPacks(state, state.selectedSet, 1);
    ui.lastReveal = null;
  } else if (!pack.torn) {
    return ripPack();
  } else if (pack.revealed < pack.cards.length) return revealCard(true);
  else { finishPack(state); ui.lastReveal = null; }
  commit();
  return true;
}

/** @param {unknown} error @returns {void} */
function reportAutomaticError(error) {
  console.error('The opening could not finish.', error);
  state.settings.auto = false;
  stageBusy = false;
  document.body.classList.remove('opening');
  commit();
  showToast('The opener paused. Your purchased cards are saved; try opening again.');
}

/** @returns {number} */
function accrueNow() {
  const now = performance.now();
  const elapsed = Math.min(OFFLINE_LIMIT, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  advance(state, elapsed);
  return elapsed;
}

/** @returns {void} */
function tick() {
  const unlockedBefore = SETS.filter(set => state.lifetimeCash >= set.unlockAt).length;
  const elapsed = accrueNow();
  const unlockedAfter = SETS.filter(set => state.lifetimeCash >= set.unlockAt).length;
  if (unlockedBefore !== unlockedAfter) {
    showToast(`${SETS[unlockedAfter - 1].name} is now in stock!`);
    if (!stageBusy) draw();
  }
  if (state.settings.auto && !document.hidden && !ui.modal && !stageBusy) {
    autoClock += Math.min(elapsed, 1);
    if (autoClock >= (state.settings.fastReveal ? 0.35 : AUTO_STEP_SECONDS)) {
      autoClock = 0;
      autoStep().catch(reportAutomaticError);
    }
  }
  updateCounters(state);
  if (performance.now() - lastSave >= SAVE_INTERVAL_MS) saveShop();
}

/** @returns {void} */
function flushShop() { accrueNow(); saveShop(); }

/** @param {Event} event @returns {void} */
function onImageError(event) {
  if (event.target instanceof HTMLImageElement && event.target.closest('.card-art,.pack-art,.box-art')) event.target.hidden = true;
}

loadShop();
saveShop();
draw();
if (ui.offline) showOffline(ui.offline.amount, ui.offline.seconds);
document.addEventListener('click', onClick);
document.addEventListener('input', onInput);
document.addEventListener('keydown', onKeyDown);
document.addEventListener('pointerover', onRelationOver);
document.addEventListener('pointerout', onRelationOut);
document.addEventListener('focusin', onRelationOver);
document.addEventListener('focusout', onRelationBlur);
document.addEventListener('pointerdown', onSealDown);
document.addEventListener('pointermove', onSealMove);
document.addEventListener('pointerup', endSealDrag);
document.addEventListener('pointercancel', endSealDrag);
document.addEventListener('error', onImageError, true);
addEventListener('pagehide', flushShop);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushShop(); else tick(); });
setInterval(tick, TICK_MS);
