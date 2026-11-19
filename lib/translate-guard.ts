/**
 * Keeps a page translator from crashing React — issue #87, "O jogo parou".
 *
 * Every page says `<html lang="en">`, `/pt` included, so a Brazilian phone set
 * to "always translate English" ran the whole site through Google Translate.
 * Translate swaps each text node React rendered for a `<font>` element; the
 * next render asks the parent to remove (or insert before) a node that is no
 * longer its child, the DOM throws `NotFoundError`, and the error boundary
 * shows the crash screen. On `/` that happened on the Start press itself, so
 * the host could not play at all. Reproduced on production 2026-11-19.
 *
 * Two layers, and neither is enough alone:
 *
 *  - **`translate="no"` and `<meta name="google" content="notranslate">`** on
 *    the root layout (and `app/global-error.tsx`). Opting out is the real fix:
 *    even when nothing throws, a translated React page shows stale text, because
 *    React keeps updating the text nodes Translate has detached — a scoreboard
 *    frozen at 0 is a worse game than an English one. Do not remove them to
 *    "let people translate": the setup page is already in their language, and
 *    the rest is the game.
 *  - **`TRANSLATE_GUARD_SCRIPT`**, run before hydration: `removeChild` and
 *    `insertBefore` tolerate a node that someone else moved. It covers what
 *    the opt-out cannot — translator extensions and browsers that ignore it.
 *    The same workaround React's own issue (#11538) settled on.
 *
 * In `lib/` so `tests/translate-guard.test.ts` can run it against a fake DOM.
 */

export const TRANSLATE_GUARD_SCRIPT = `(function(){
if(typeof Node!=="function"||!Node.prototype)return;
var P=Node.prototype,rm=P.removeChild,ib=P.insertBefore;
if(P.__gsTranslateGuard)return;P.__gsTranslateGuard=true;
P.removeChild=function(child){
if(child&&child.parentNode!==this){
if(child.parentNode)child.parentNode.removeChild(child);
return child;}
return rm.apply(this,arguments);};
P.insertBefore=function(node,ref){
if(ref&&ref.parentNode!==this)return ib.call(this,node,null);
return ib.apply(this,arguments);};
})();`;
