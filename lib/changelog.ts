/**
 * Player-facing release notes for the footer's "What's new" overlay.
 *
 * Deliberately *not* generated from CHANGELOG.md. That file is written for
 * whoever maintains this code — it talks about Durable Objects, KV round-trips
 * and function names, and its "Known gaps" sections are a maintainer's todo
 * list. This list is for someone who came here to play a party game and wants
 * to know what changed since last time. Both are hand-written, and a release
 * updates both.
 *
 * ## Why every line is bilingual
 *
 * `/zh` exists because the Chinese landing page is written natively rather than
 * translated (see CHANGELOG 0.4.0), and its footer says 回報問題, not "Report a
 * problem". An English-only overlay opening off that footer would undo the one
 * thing that page is for. So each entry carries both languages side by side,
 * as parallel fields rather than two separate lists — a missing translation is
 * then a type error at the callsite instead of a silent English fallback, and
 * a test asserts neither side is empty.
 *
 * Newest first. The overlay trusts that order: it reports `entries[0].version`
 * as the version a reader saw, so a release added out of order would attribute
 * its reads to the wrong version.
 */

// The locale type and the overlay's chrome strings live in lib/changelog-ui.ts
// so the footer button can import them without pulling every release note
// into the page's first load; re-exported here so nothing else has to know.
export type { ChangelogLocale } from "./changelog-ui";
export { CHANGELOG_UI } from "./changelog-ui";
import type { ChangelogLocale } from "./changelog-ui";

export type { ChangeKind } from "./changelog-ui";
import type { ChangeKind } from "./changelog-ui";

export interface ChangelogChange {
  kind: ChangeKind;
  /** Plain text — the overlay does not render markdown. */
  text: string;
  /** Traditional Chinese. Written for a Chinese reader, not translated word for word. */
  textZh: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date. Formatted by `formatChangelogDate`, never `toLocaleDateString` —
   *  see the note on that function. */
  date: string;
  /** One line on what this release was about. */
  headline: string;
  headlineZh: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.12.1",
    date: "2026-09-16",
    headline:
      "The Taste Quiz no longer calls a song from your playlist the wrong answer, and Mixed Playlist Mode keeps every Chinese, Japanese and Korean song in the pool.",
    headlineZh:
      "品味鑒定不會再把你歌單裡的歌當成錯誤答案；混合歌單模式也不會再弄丟中文、日文、韓文歌了。",
    changes: [
      {
        kind: "fixed",
        text: "A song that is in your playlist could be shown as the wrong answer whenever Spotify spells it differently from our list: Simplified Chinese for a mainland artist (演员 next to 演員), an English title for K-pop (Spring Day is 봄날), a full-width bracket, an extra space. The quiz now reads all of those as the same song.",
        textZh: "只要 Spotify 的寫法跟我們的名單不一樣，歌單裡的歌就有可能被當成錯誤選項：大陸歌手的簡體字（演员和演員）、K-pop 的英文歌名（Spring Day 就是 봄날）、全形括號、多一個空格。現在這些都會被認出是同一首歌。",
      },
      {
        kind: "fixed",
        text: "Mixed Playlist Mode was merging every Chinese, Japanese or Korean song by one artist into a single song, so a Jay Chou playlist came out as one Jay Chou track. Every song counts now.",
        textZh: "混合歌單模式之前會把同一位歌手的中日韓歌曲全部合併成一首，一份周杰倫歌單最後只剩一首周杰倫。現在每一首都算數。",
      },
      {
        kind: "better",
        text: "A K-pop question shows its decoy in the same language as the real song: 봄날 beside a Korean title, Spring Day beside an English one. And an artist credited two ways on Spotify (周興哲 and 周兴哲) counts as one, so the quiz can still pick the harder same-artist decoy.",
        textZh: "K-pop 的題目，誘答選項會用跟正確答案一樣的語言：韓文歌名旁邊是 봄날，英文歌名旁邊是 Spring Day。Spotify 上有兩種寫法的歌手（周興哲和周兴哲）也會被當成同一位，題目還是能挑出最難分的同歌手選項。",
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-09-15",
    headline:
      "A simpler start: paste a playlist, add players, press Start. The other modes and the settings step aside, and the Taste Quiz has its own page.",
    headlineZh:
      "更簡單的開場：貼上歌單、加玩家、按開始。其他模式和設定都退到一旁，品味鑒定也有了自己的頁面。",
    changes: [
      {
        kind: "new",
        text: "The Taste Quiz lives at guessong.app/quiz now — its own page instead of a third button on the party form. Old links still get you there.",
        textZh: "品味鑒定現在在 guessong.app/quiz，有自己的頁面，不再是派對表單上的第三個按鈕。舊連結還是會帶你過去。",
      },
      {
        kind: "better",
        text: "The home page asks three things: playlist, players, Start. Clip length, song count and Buzzer Mode sit behind one line that shows what they are set to, and Mixed mode is a link under Start.",
        textZh: "首頁只問三件事：歌單、玩家、開始。片段長度、歌曲數和搶答模式收在一行裡，看得到目前的設定；混合歌單模式變成開始按鈕下面的一個連結。",
      },
      {
        kind: "better",
        text: "During a round, Reveal Answer is the one big button; pause, replay and the album-art hint sit smaller under it. The three No one buttons are gone: if nobody got it, just press Next Track. Quit is gone too — End Game takes you to the scores.",
        textZh: "一回合裡，「揭曉答案」是唯一的大按鈕；暫停、重播和專輯封面提示縮小放在下面。三個「沒人答對」按鈕拿掉了：沒人猜到就直接按下一首。「離開」也拿掉了，「結束遊戲」會帶你到計分板。",
      },
      {
        kind: "better",
        text: "Every page loads lighter: these release notes only download when you open them, and buttons and links are easier to tap on a phone.",
        textZh: "每一頁都變輕了：這份更新內容只有在你打開時才下載，按鈕和連結在手機上也更好按。",
      },
      {
        kind: "fixed",
        text: "On a quiz link that has expired, Make your own quiz now goes to the quiz page rather than the party game.",
        textZh: "在已經過期的測驗連結上，「自己做一份品味鑒定」現在會到測驗頁面，而不是派對模式。",
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-09-14",
    headline:
      "Taste Quiz: every question tells you right or wrong as you tap it, and the link's preview in the chat is about your quiz, not the party game.",
    headlineZh:
      "品味鑒定：每題按下去就知道對錯，貼進群組的連結預覽也會顯示你的測驗，不再是派對模式的罐頭卡片。",
    changes: [
      {
        kind: "new",
        text: "Tap a song and you're told right there whether it's the one — the right song lights up green, a wrong pick goes red — then the next question slides in. The score comes at the end; the answer list under it is gone, since you've already seen every answer.",
        textZh: "按下一首歌，當場就告訴你對不對：對的那首會亮綠色，選錯會變紅色，然後才進下一題。分數在最後看；結果頁下面那份解答收掉了，因為每一題你都已經看過答案。",
      },
      {
        kind: "fixed",
        text: "Pasted into Facebook, Messenger or X, the quiz link now unfurls as your quiz — whose taste, how many questions, with its own picture — instead of the home page's card. It used to show \"Guess the Song — Free Music Guessing Party Game\" with your name nowhere.",
        textZh: "把連結貼到 Facebook、Messenger 或 X，預覽現在會顯示你的測驗：是誰的品味、幾題、還有專屬的圖片，而不是首頁的卡片。之前它會顯示「Guess the Song — 免費猜歌派對遊戲」，你的名字完全不在上面。",
      },
      {
        kind: "better",
        text: "A question you've already answered stays answered: going back shows it with its verdict, and a reload mid-quiz puts you back on the same question with the verdicts you've seen.",
        textZh: "答過的題目就是答過了：往回看會連同對錯一起顯示，中途重新整理也會回到同一題，之前看過的對錯都還在。",
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-09-14",
    headline:
      "Taste Quiz, a week in: the link opens on the quiz, your progress survives a reload, and a taken name is refused before you start.",
    headlineZh:
      "品味鑒定上線一週後的修正：連結會直接打開測驗、答到一半重新整理不會歸零、名字已經有人用會在開始前就告訴你。",
    changes: [
      {
        kind: "fixed",
        text: "\"Make one for your friends\" now lands on the Taste Quiz form, not on the party game at the top of the page.",
        textZh: "「幫你的朋友做一份」現在會直接落在品味鑒定的表單上，不再是頁面最上面的派對模式。",
      },
      {
        kind: "fixed",
        text: "If someone on the board already has your name you're told before you start, not after twenty questions. Finished earlier on this phone? Your result comes back with one tap instead of a second row on the board.",
        textZh: "排行榜上已經有人用了你的名字，會在開始前就說，不用答完二十題才知道。之前在這支手機做完過？一鍵就能再看到你的結果，不會在榜上多出一行。",
      },
      {
        kind: "fixed",
        text: "Reloading mid-quiz, or swiping back on your phone, no longer throws your answers away. Back goes to the previous question; your progress is where you left it.",
        textZh: "答到一半重新整理、或在手機上往回滑，答案不會不見了。返回會回到上一題，進度就停在你離開的地方。",
      },
      {
        kind: "fixed",
        text: "The two songs no longer give the answer away by how the singer's name is spelled — a decoy is credited the way your playlist credits that artist.",
        textZh: "兩首歌不會再因為歌手名字的寫法而洩題：假選項的歌手會照你歌單裡的寫法來標。",
      },
      {
        kind: "better",
        text: "Pasted into a group chat, the quiz link now unfurls with a picture, like the home page does.",
        textZh: "把連結貼進群組，預覽現在會帶圖，跟首頁一樣。",
      },
      {
        kind: "better",
        text: "A new verdict between \"getting there\" and \"total stranger\": land between half and six in ten and it's a coin flip, not a stranger. Stranger now means worse than guessing.",
        textZh: "「有點懂」和「完全陌生人」之間多了一級：對一半到六成，是用猜的，不是陌生人。陌生人現在是比亂猜還差。",
      },
      {
        kind: "better",
        text: "The results page refreshes on a tap and only crowns \"everyone knew\" when everyone actually did. Share and copy say so when they fail. Making a second quiz no longer hides the link you just made, and the Chinese home page and the about page now mention the quiz.",
        textZh: "結果頁可以手動重新整理，「大家都會」只在真的每個人都答對時才會出現。分享和複製失敗時會告訴你。再做一份不會把剛做好的連結收掉，中文首頁和「怎麼玩」也都提到了品味鑒定。",
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-09-14",
    headline:
      "Taste Quiz — turn your playlist into a link. Friends open it on their own phone, guess which songs are really yours, and land on a board of who knows you best.",
    headlineZh:
      "新功能「品味鑒定」：把你的歌單變成一條連結。朋友用自己的手機打開，猜哪些歌真的在你的歌單裡，最後看誰最懂你。",
    changes: [
      {
        kind: "new",
        text: "A third mode on the setup page. Paste a playlist, pick anywhere from 10 to 50 questions, add your name if you like, and you get a link and a QR code. Nothing to install, nobody has to be in the room.",
        textZh: "首頁多了第三個模式。貼上歌單、題數 10 到 50 隨你選、想的話加上名字，就會拿到一條連結和 QR code。不用安裝、也不用大家在同一個地方。",
      },
      {
        kind: "new",
        text: "Every question is a duel: two songs fill the screen, one is really in the playlist, tap the one you believe. If you're stuck, a rationed hint plays the song that's really in there. Hints count against you in a tie, so guessing stays the game.",
        textZh: "每一題都是二選一：兩首歌佔滿整個畫面，只有一首真的在歌單裡，點你相信的那一首。卡住的話有限量的提示可以聽一段。同分時用過提示的排後面，所以還是要先猜。",
      },
      {
        kind: "new",
        text: "A leaderboard on the link itself. The first fifty to finish go on the board under the name they typed, once each. The link lasts a week.",
        textZh: "連結本身就有排行榜。最先作答完的五十個人用打的名字上榜，一人一次。連結保留一週。",
      },
      {
        kind: "new",
        text: "A results page for whoever made the quiz: how many took it, the full ranking, and for each question how many people got it. Only visible on the device that made the quiz, since it shows the answers.",
        textZh: "出題的人有自己的結果頁：幾個人作答、完整排行榜、每一題有多少人答對。因為會顯示答案，只有建立測驗的那台裝置看得到。",
      },
      {
        kind: "better",
        text: "The quiz page reads in the language your phone is set to, and the link's preview in a group chat carries the owner's name in their language.",
        textZh: "測驗頁面會用你手機的語言顯示，貼到群組時的連結預覽也會用出題者的語言顯示他的名字。",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-08-30",
    headline:
      "Six new guides — quiz round ideas, running one for a big group, playing over a video call, and what to do when a single song has no clip.",
    headlineZh:
      "新增六篇指南：各種猜歌回合的玩法、人多的時候怎麼帶、用視訊通話怎麼玩，還有某一首歌播不出聲音時該怎麼辦。",
    changes: [
      {
        kind: "new",
        text: "Twelve music quiz round formats, sorted by what each one does to a room — which ones let a quieter player win, and where each belongs in a running order.",
        textZh: "十二種猜歌回合的玩法，照「會讓現場氣氛怎麼變」來分類：哪一種能讓比較安靜的人有機會贏，還有整晚的順序怎麼排。",
      },
      {
        kind: "new",
        text: "A guide to running a quiz for twenty people or more: the three things that break at that size, and why teams fix all of them at once.",
        textZh: "一篇專門講二十人以上怎麼玩的指南：人一多會壞掉的三件事，以及為什麼分組一次就能解決全部。",
      },
      {
        kind: "new",
        text: "How to run one over Zoom, Meet or Discord — the exact audio setting to turn on for each, and the one rule you have to drop because everyone hears the clip at a different moment.",
        textZh: "怎麼用 Zoom、Meet 或 Discord 玩：每個平台要打開哪個聲音設定，還有一條一定要放棄的規則，因為每個人聽到片段的時間都不一樣。",
      },
      {
        kind: "new",
        text: "Why one song can be silent when the rest of the playlist plays fine, and how to tell a genuine catalogue gap from us being temporarily rate limited.",
        textZh: "為什麼歌單其他歌都正常，卻只有一首沒有聲音；以及怎麼分辨是那首歌真的找不到片段，還是我們暫時被對方限流了。",
      },
      {
        kind: "new",
        text: "The rules of guess the song written out properly, with nine variants and the four house rules worth agreeing before you start.",
        textZh: "把猜歌遊戲的規則好好寫了一遍，附九種變化玩法，還有開場前值得先講好的四條自訂規則。",
      },
      {
        kind: "new",
        text: "A plain-language look at music licensing for quiz nights: when it applies, who normally already holds the licence, and what a thirty-second preview clip does and does not cover.",
        textZh: "用白話講猜歌之夜的音樂授權：什麼情況下才需要、通常是場地方早就處理好了，以及三十秒試聽片段涵蓋與不涵蓋的範圍。",
      },
    ],
  },
  {
    version: "1.7.5",
    date: "2026-08-25",
    headline:
      "Fixed the clip playing a different song from the one on the answer card \u2014 both the late-arriving kind and the wrong-recording kind.",
    headlineZh:
      "修好了播出來的音樂跟答案卡上的歌對不起來的問題，包含「慢一步才播出來」和「一開始就抓錯錄音」兩種狀況。",
    changes: [
      {
        kind: "fixed",
        text: "If you got tired of waiting on \u201cFinding audio\u2026\u201d and pressed Skip Track or Reveal Answer, the clip that was still loading could start playing on the next song, or on top of the answer you had just revealed. It is now dropped instead.",
        textZh: "如果你等「Finding audio…」等到不耐煩，按了跳過或直接公布答案，那首還在載入的音樂有可能會接著在下一首播出來，或是蓋在你剛公布的答案上。現在它會直接被丟掉，不會再亂播。",
      },
      {
        kind: "fixed",
        text: "Songs with very common titles could play a tribute band or karaoke version instead of the real recording, which then contradicted the answer card. The check that matches the artist no longer counts a name like \u201cHello Adele Tribute\u201d as Adele.",
        textZh: "歌名很菜市場的歌，以前有可能播出致敬樂團或卡拉 OK 版本，而不是原本那個錄音，跟答案卡對不起來。現在比對歌手的方式改過了，像「Hello Adele Tribute」這種名字不會再被當成 Adele。",
      },
      {
        kind: "fixed",
        text: "Remastered and live-tagged tracks could end up playing a different song from the same album. The title is now matched with those tags taken off, so the remaster finds its own recording.",
        textZh: "標了 Remastered 或 Live 的歌，以前有可能播成同一張專輯裡的另一首。現在比對歌名的時候會先把這些標籤拿掉，重製版就能找回自己那個錄音。",
      },
    ],
  },
  {
    version: "1.7.4",
    date: "2026-08-24",
    headline:
      "Fixed the error screen that could replace a whole game, and the site now warns you before the day's playlist allowance runs out rather than after.",
    headlineZh:
      "修好了會讓整場遊戲變成錯誤畫面的問題，另外網站現在會在當天歌單額度快用完之前先提醒你，而不是等到用完才說。",
    changes: [
      {
        kind: "fixed",
        text: "Pressing Start could end on \u201cApplication error: a client-side exception has occurred\u201d, with nothing to click and nothing to read. It is gone, and if anything else ever breaks that way you now get a real message and a Start over button instead of a blank page.",
        textZh: "以前按下開始有可能整頁變成「Application error」的錯誤訊息，沒有東西可以點、也看不懂發生什麼事。這個問題已經修好了，而且之後就算真的出錯，你會看到一段看得懂的說明和一個「重新開始」按鈕，不會再是一片空白。",
      },
      {
        kind: "fixed",
        text: "If your browser blocks websites from saving data, the game used to tell you the playlist could not be loaded \u2014 so you would swap playlists all evening and never get anywhere. It now says it is your browser, and what to change.",
        textZh: "如果你的瀏覽器不讓網站儲存資料，以前遊戲會說歌單載入失敗，害你整晚一直換歌單卻怎麼樣都開不了。現在它會直接告訴你是瀏覽器設定的問題，也會說要改哪裡。",
      },
      {
        kind: "new",
        text: "Everyone here shares one Spotify allowance, and it can run out on a busy day. When it gets close, you now see a heads-up while the site still works, so you can load your playlist before it matters. Playlists that have already been played are never affected.",
        textZh: "這裡的每個人共用同一份 Spotify 額度，忙碌的一天有可能會用完。現在快用完的時候，你會在網站還正常運作的時候先看到提醒，可以趁還有額度的時候先把歌單載入。已經玩過的歌單完全不受影響。",
      },
    ],
  },
  {
    version: "1.7.3",
    date: "2026-08-23",
    headline:
      "When the site cannot load new playlists, the notice now tells you why, says sorry, and points you at the source if you would rather not wait.",
    headlineZh:
      "當網站載入不了新歌單的時候，公告現在會告訴你原因、跟你說聲抱歉，如果你不想等，也會告訴你可以去哪裡自己架一站。",
    changes: [
      {
        kind: "better",
        text: "The notice says that GuessSong is free, and that Spotify's rules leave no way to buy a bigger allowance. It used to say only that the allowance was gone, which reads either as nobody looking after the site or as something money would fix. Neither is true, and it says sorry for it.",
        textZh: "公告會說明 GuessSong 是免費的，而且 Spotify 的規則沒有留給我們加購額度的辦法。以前它只說額度用完了 —— 那讀起來要嘛像是沒人在管這個網站，要嘛像是花錢就能解決，兩個都不是真的。現在它也會為此道歉。",
      },
      {
        kind: "new",
        text: "The notice now has a link to the source code. GuessSong is open source, so anyone who would rather not share one allowance with everybody else can run their own copy on their own Spotify account.",
        textZh: "公告上現在有一個原始碼的連結。GuessSong 是開源的，所以不想跟其他人共用同一份額度的人，可以用自己的 Spotify 帳號架一站自己跑。",
      },
      {
        kind: "fixed",
        text: "On a small phone the notice can be scrolled. The message got longer, and the page behind it is locked while it is open, so the last line used to be out of reach.",
        textZh: "在螢幕比較小的手機上，公告現在可以捲動。訊息變長了，而公告開著的時候後面的頁面是鎖住的，所以以前最後一行會看不到。",
      },
    ],
  },
  {
    version: "1.7.2",
    date: "2026-08-23",
    headline:
      "When Spotify has cut the site off, you now find out before you paste a playlist instead of after you press Start.",
    headlineZh:
      "當 Spotify 把整個網站擋下來的時候，現在你在貼上歌單之前就會知道，而不是按下開始以後才發現。",
    changes: [
      {
        kind: "new",
        text: "A notice on the way in when new playlists are not loading. Spotify limits this whole site as one, so when its daily allowance runs out nobody can load anything new — and until now the only way to discover that was to paste a link, press Start, and be refused.",
        textZh: "當新歌單載入不了的時候，一進站就會看到公告。Spotify 是把整個網站當成一個來限制的，所以它的每日額度用完時，任何人都載不了新歌單 —— 而在此之前，唯一發現的方法是貼上連結、按下開始，然後被拒絕。",
      },
      {
        kind: "better",
        text: "The notice takes itself down. It reads the same signal the game does, so the moment Spotify starts answering again it is gone, without anybody having to remember to remove it.",
        textZh: "這個公告會自己消失。它讀的是遊戲本身在讀的同一個訊號，所以 Spotify 一恢復回應它就不見了，不需要任何人記得回來把它拿掉。",
      },
      {
        kind: "better",
        text: "Players joining a mixed-playlist room see it too, since their submission goes through the same place. A room that quietly collected nothing was the worst version of this.",
        textZh: "加入混合歌單房間的玩家也看得到，因為他們送出的歌單走的是同一條路。房間安安靜靜什麼都沒收到，是這件事最糟的版本。",
      },
      {
        kind: "new",
        text: "The site now paces how many new playlists it loads from Spotify across the day, instead of using the allowance up as fast as it arrives. On a busy day that means a handful of hosts are asked to wait at the edges — which is the trade for not having Spotify shut every new playlist out for thirteen hours at a time, which is what happened this week.",
        textZh: "網站現在會把向 Spotify 載入新歌單的數量分配到一整天，而不是有多少就用多快。忙碌的日子裡，這代表少數幾位主持人會在邊緣被請稍等 —— 這是為了不要再被 Spotify 一次擋掉十三個小時所做的取捨，而那正是這週發生的事。",
      },
      {
        kind: "better",
        text: "Playlists you have already loaded keep working through all of this. Whatever is happening with Spotify, a party that has started is not interrupted by it.",
        textZh: "在這整個過程中，你已經載入過的歌單都還是能用。不管 Spotify 那邊發生什麼事，已經開始的派對不會被打斷。",
      },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-08-23",
    headline:
      "Spotify cut the whole site off for a day, so loading a playlist now costs half as much and the message you get when it happens is honest.",
    headlineZh:
      "Spotify 一度把整個網站擋了一整天，所以現在載入歌單的成本少了一半，真的被擋的時候訊息也不再騙人。",
    changes: [
      {
        kind: "fixed",
        text: "Loading a playlist asks Spotify for half as much. Every game used to send two requests where one would do, which is a large part of why the shared allowance ran out in the first place.",
        textZh: "載入歌單時跟 Spotify 要的東西少了一半。以前每一場遊戲都送出兩個請求，其實一個就夠了 —— 那正是共用額度會被用完的一大原因。",
      },
      {
        kind: "better",
        text: "A playlist you used last night loads instantly tonight. They used to be forgotten after six hours, which is just short enough to miss the gap between two parties.",
        textZh: "昨晚用過的歌單，今晚一秒就開得起來。以前只記住六個小時，而六個小時剛好差一點，接不上兩場派對之間的間隔。",
      },
      {
        kind: "fixed",
        text: "When Spotify does refuse everyone, you are told what actually happened instead of a countdown. The old message promised a wait of a few minutes even when the real answer was the next day, so you would come back and be told the same thing again.",
        textZh: "當 Spotify 真的把所有人擋下來時，你看到的是實話，而不是一個倒數。以前的訊息說再等幾分鐘就好，就算實際上要等到隔天 —— 於是你回來以後，只會再被告知一次同樣的幾分鐘。",
      },
      {
        kind: "better",
        text: "Playlists already loaded keep working while that is going on, so a party in the middle of a game is not interrupted by someone else starting one.",
        textZh: "在那期間，已經載入過的歌單照常能玩 —— 玩到一半的派對不會因為別人剛好要開一場而被打斷。",
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-21",
    headline:
      "There is now a guides section, and every page carries a proper footer with a privacy policy and terms.",
    headlineZh: "新增了遊戲指南專區，每一頁的頁尾也都有了完整的隱私權政策與服務條款。",
    changes: [
      {
        kind: "new",
        text: "Guides. Eight longer pieces on running one of these evenings: how to host a music quiz night, how to pick a playlist that actually plays well, what clip length does to a room, how to score a game so the last round still matters, and what to do when a Spotify playlist refuses to load. Linked from the footer of every page.",
        textZh: "遊戲指南。八篇比較長的文章，講的是怎麼把一場猜歌之夜辦好：怎麼主持、怎麼挑一個真的適合猜的歌單、片段長度會怎麼改變整個房間的氣氛、分數要怎麼算最後一輪才還有意義，以及歌單讀不出來的時候該怎麼辦。每一頁的頁尾都能進去。",
      },
      {
        kind: "new",
        text: "A privacy policy, terms of use and a contact page — the privacy policy and terms in both English and Chinese. The privacy policy says exactly what is stored and for how long, which for a game with no accounts is a shorter list than you might expect.",
        textZh: "新增隱私權政策、服務條款和聯絡頁面，其中隱私權政策與服務條款都有中英文版本。隱私權政策明確寫出什麼東西會被存下來、存多久 —— 對一個沒有帳號的遊戲來說，這份清單比你想的短。",
      },
      {
        kind: "better",
        text: "One footer everywhere. The homepage, the how-to-play page and the Chinese page used to each have their own; now they share one, so the links to the policies, the guides and the release notes are in the same place on every page.",
        textZh: "頁尾全站統一。首頁、玩法說明頁和中文頁以前各有各的頁尾，現在共用同一個 —— 政策、指南和更新說明的連結，在每一頁都在同一個位置。",
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-15",
    headline:
      "Mixed Playlist games now hand the merged playlist back at the end, and tell you how the guessing actually went.",
    headlineZh: "混合歌單模式現在會在結束時把合併好的歌單交還給你，並告訴你這一場猜得如何。",
    changes: [
      {
        kind: "new",
        text: "Copy the Mix. At the end of a Mixed Playlist game there is a button that copies the whole merged tracklist, with each song credited to whoever brought it, ready to paste into your group chat. Anyone who submitted a playlist is named even if none of their songs made the cut — they turned up, so they are on the list.",
        textZh: "「複製這份混音」。混合歌單模式結束時多了一個按鈕，會把合併後的完整曲目複製起來，每首歌都標著是誰帶來的，可以直接貼到群組裡。有交歌單但一首都沒被抽到的人也會列在名單上 —— 人有來，名字就在。",
      },
      {
        kind: "new",
        text: "A line under the final scores saying how many songs nobody could name and how many were traced back to the right playlist. Two parties can end on the same scoreboard having had completely different evenings, and this is the part the scoreboard cannot show.",
        textZh: "最終比分下面多了一行，寫著有幾首歌全場都叫不出名字、有幾首被猜對了出處。兩場派對可能以一樣的比分收場，過程卻完全不同，而那正是比分表看不出來的部分。",
      },
      {
        kind: "fixed",
        text: "The taste card no longer prints an empty AWARDS heading when a group shares no songs and no awards can be worked out — which is exactly what happens when everyone's music comes from somewhere different.",
        textZh: "當一群人完全沒有重疊的歌、算不出任何獎項時，品味卡不會再印出一個空的 AWARDS 標題 —— 而那正好是每個人的音樂各來自一方時會發生的情況。",
      },
      {
        kind: "fixed",
        text: "\"Most obscure taste\" used to go to whoever submitted their playlist first whenever nobody guessed anyone's songs correctly. It now goes to whoever brought the most songs that nobody could place.",
        textZh: "以前只要全場都沒人猜對任何人的歌，「最冷門品味」就會頒給最早交歌單的那個人。現在會頒給帶了最多首、而且沒人認得出來的那一位。",
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-13",
    headline:
      "You can now pick any number of songs, and the sample playlists on the home page are gone.",
    headlineZh: "現在可以自己決定要玩幾首歌，首頁的範例歌單則已移除。",
    changes: [
      {
        kind: "new",
        text: "Number of Songs has a box you can type into. The buttons are still there for 10, 20, 30, 50 or the whole playlist, but if you want a 7-song round before dinner, type 7. Anything up to 500 works, and a shorter playlist simply plays every track it has.",
        textZh:
          "「歌曲數量」多了一個可以自己輸入的欄位。10、20、30、50 和整份歌單的按鈕都還在，但如果你想在晚餐前玩個 7 首，直接輸入 7 就好。最多可以到 500 首；歌單比你輸入的數字短的話，就把它整份播完。",
      },
      {
        kind: "better",
        text: "The three sample playlists on the home page have been removed, along with the solo round they started. GuessSong is a game for a room full of people, and the home page now says only that: paste a playlist, add names, play.",
        textZh:
          "首頁上的三份範例歌單已經移除，連同它們開啟的單人模式一起。GuessSong 是給一屋子人一起玩的遊戲，首頁現在只講這件事：貼上歌單、加入名字、開始玩。",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-13",
    headline:
      "Rooms are steadier when a crowd scans at once, and the whole app leans much less on its storage.",
    headlineZh:
      "一群人同時掃碼時房間更穩，整個 app 對儲存空間的用量也降了一大截。",
    changes: [
      {
        kind: "fixed",
        text: "When several people submitted a playlist at the same instant — which is what happens when everyone scans the QR code together — one of them could quietly go missing from the room. Two people can no longer end up sharing one name either.",
        textZh:
          "好幾個人同一瞬間送出歌單時——大家一起掃 QR code 就是這樣——其中一個人可能會悄悄從房間裡消失。現在也不會再有兩個人共用同一個名字。",
      },
      {
        kind: "better",
        text: "Last month the site went down because our storage hit its monthly limit. We went through everything that touches it: the room screen now checks less often once nobody new is arriving, and the parts that fetch song clips stopped asking the same question over and over. Same game, a fraction of the usage.",
        textZh:
          "上個月網站掛掉，是因為儲存空間用完了當月額度。我們把所有會用到它的地方重新檢查過一遍：沒有新人加入時，房間畫面就不再一直查詢；抓歌曲片段的部分也不會再重複問同一個問題。玩法完全一樣，用量只剩一小部分。",
      },
      {
        kind: "better",
        text: "The room list still updates just as fast while people are joining — it only slows down after a stretch where nobody new has arrived, and speeds straight back up the moment someone does.",
        textZh:
          "有人陸續加入的時候，房間名單更新速度跟以前一模一樣；只有在一段時間都沒有新人時才會放慢，而且一有人加入就立刻恢復。",
      },
    ],
  },
  {
    version: "1.3.2",
    date: "2026-08-13",
    headline:
      "Playlists load again, and a mixed game now plays the full number of songs you picked.",
    headlineZh:
      "歌單恢復正常，混合歌單也會照你選的首數播好播滿。",
    changes: [
      {
        kind: "fixed",
        text: "For a while no playlist would load at all, and the message blamed your link. The link was fine — our storage had hit its monthly limit and the whole site went down with it. The game now keeps working when that happens.",
        textZh:
          "有一陣子不管貼什麼歌單都讀不進來，畫面還叫你檢查連結。連結沒問題，是我們的儲存空間用完了當月額度，整個網站跟著掛掉。現在就算再發生一次，遊戲也照常玩得下去。",
      },
      {
        kind: "fixed",
        text: "Mixed Playlist games were quietly shorter than the number you asked for, and the more taste two players shared the shorter it got — two people who like the same music could pick 8 songs each and get 12 instead of 16. Now it fills up to the full amount.",
        textZh:
          "混合歌單以前會偷偷變短，而且兩個人口味越接近就越短——都選每人 8 首，最後可能只播到 12 首而不是 16 首。現在會補滿到你選的數量。",
      },
      {
        kind: "better",
        text: "Once a room has expired or the game has started, the app stops checking on it. Before, a forgotten tab kept asking about that room all day.",
        textZh:
          "房間過期或遊戲開始之後，就不再繼續查詢它的狀態。之前忘了關的分頁會整天一直問下去。",
      },
    ],
  },
  {
    version: "1.3.1",
    date: "2026-08-10",
    headline:
      "When a playlist will not open, the game says so straight away instead of making you wait for the same answer twice.",
    headlineZh:
      "遇到打不開的歌單，現在會馬上告訴你，不用再等一次一樣的答案。",
    changes: [
      {
        kind: "better",
        text: "Tapping Start again on a playlist we cannot open now answers instantly. Before, every tap went off and came back with the same message.",
        textZh:
          "歌單打不開時再按一次「開始遊戲」，會立刻顯示原因。以前每按一次都要重新問一遍，再回來給你同樣的訊息。",
      },
      {
        kind: "better",
        text: "The app icons and the preview image on shared links are now made ahead of time, so pages and shared links open faster.",
        textZh:
          "App 圖示和分享連結的預覽圖改成事先做好，開啟頁面或點開分享連結都更快。",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-09",
    headline:
      "If you played on someone else's phone, you can now find your way back — the game finally tells you what it is called.",
    headlineZh:
      "在別人的房間玩過之後，現在找得到回來的路了 —— 這個遊戲總算會告訴你它叫什麼名字。",
    changes: [
      {
        kind: "new",
        text: "The Game Over screen now shows a QR code. Everyone in the room already has their phone out from buzzing, so anyone who wants to run the next party can just point it at the screen.",
        textZh:
          "遊戲結束的畫面現在會顯示一個 QR code。大家搶答完手機本來就還在手上，誰想主辦下一場，對著螢幕掃一下就好。",
      },
      {
        kind: "new",
        text: "Saved result cards carry a QR code too. Until now a card you sent to a group chat said the name of the game and nothing else, so anyone it reached had to already know where to find us.",
        textZh:
          "存下來的成績卡也帶著 QR code 了。以前傳到群組裡的卡片只寫了遊戲名字，收到的人得本來就知道去哪裡找我們才行。",
      },
      {
        kind: "better",
        text: "The buzzer and playlist pages on your phone now say what this is and link back to it. They used to be a dead end: you buzzed, the game ended, and the page never mentioned the name at all.",
        textZh:
          "手機上的搶答頁和交歌單頁，現在會說明這是什麼並附上連結。以前那是死路：你按完搶答鈕、遊戲結束，那個頁面從頭到尾沒提過名字。",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-09",
    headline:
      "The clip you hear is now the recording on the answer card — not a cover, and not some other song that happened to share the title.",
    headlineZh:
      "現在放出來的片段，就是答案卡上的那個版本 —— 不是翻唱，也不是剛好同名的另一首歌。",
    changes: [
      {
        kind: "fixed",
        text: "Sometimes the clip that played was the wrong recording. We looked songs up by title and took whatever came back first, so a cover version, or an unrelated song with the same name, could win — asking for Adele's Hello could get you a children's version of it. Worse, we remembered that answer for a year. We now check the artist and the exact length of the track before playing anything, and if neither lines up we say there is no audio rather than play you something wrong.",
        textZh:
          "有時候放出來的片段根本是別的版本。以前我們用歌名去找，回來第一個就拿來用，所以翻唱版、或是剛好同名的另一首歌都可能被選中 —— 想聽 Adele 的 Hello，放出來的可能是兒歌版。更糟的是，這個錯誤答案會被記住一年。現在我們會先確認歌手，還會比對歌曲的精確長度，兩個都對不上就寧可顯示沒有音檔，也不放錯的給你。",
      },
      {
        kind: "better",
        text: "Chinese, Japanese and Korean songs are matched far more reliably. The music services we get clips from usually list them under an English name, so checking the artist alone never worked for them — the length of a recording, though, is the same number in every language, and that is what we now compare.",
        textZh:
          "中文、日文、韓文歌的比對準確度大幅提升。我們取得片段的音樂服務通常會用英文名稱收錄這些歌，所以光比對歌手名字對它們從來沒用過 —— 但一首錄音的長度，在哪個語言裡都是同一個數字，現在我們比的是這個。",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-03",
    headline:
      "Fewer songs turn up silent, and the ones that do play start faster. Plus the messages you get when something goes wrong are finally in your own language.",
    headlineZh:
      "更少歌變成沒聲音，會響的也響得更快。另外，出狀況時跳出來的訊息，終於是用你看得懂的語言寫的了。",
    changes: [
      {
        kind: "fixed",
        text: "Songs that showed up as \"no audio\" often had audio all along. When lots of people were playing at once, the service we get clips from would tell us to slow down — and we wrote that down as \"this song has no clip\" and stopped asking for a week. Now we tell the two apart, and a song is only written off when it really has nothing.",
        textZh:
          "以前顯示「沒有音檔」的歌，很多其實是有的。同時上線的人一多，提供試聽片段的服務就會要我們慢一點，而我們把那句話記成了「這首歌沒有試聽」，然後整整一週不再問。現在這兩件事分得清楚了，只有真的找不到才會被放棄。",
      },
      {
        kind: "better",
        text: "The clips for a whole game are now fetched the moment you land on the game screen, instead of one at a time as you play. The first Play is quicker, and a bad moment on the internet no longer lands on you mid-round.",
        textZh:
          "整場遊戲的試聽片段，現在一進遊戲畫面就一次抓齊，不再是玩到哪抓到哪。第一次按播放更快，網路不順的時候也不會剛好卡在你正在出題的那一輪。",
      },
      {
        kind: "better",
        text: "If a clip goes quiet because its link expired, the game fetches a fresh one and carries on instead of skipping the round.",
        textZh:
          "如果某首歌的試聽連結過期而沒聲音，遊戲會自己去換一條新的接著播，而不是整輪跳過。",
      },
      {
        kind: "fixed",
        text: "Playlists that refused to load at busy times. Spotify limits how much the whole site can ask for, not how much you can, so one person's playlist could fail because of everyone else's. We now remember playlists we have already seen, and when we do get told to wait, we say so instead of telling you your link is wrong.",
        textZh:
          "尖峰時段歌單讀不出來的問題。Spotify 限制的是整個網站的總用量，不是你個人的，所以你的歌單可能因為別人而失敗。現在看過的歌單會被記住，真的被要求等待時也會照實說，而不是叫你去檢查自己的連結。",
      },
      {
        kind: "better",
        text: "Every error message now appears in Chinese or English depending on the phone reading it — so a guest scanning someone else's QR code can read what went wrong, whichever language the host uses.",
        textZh:
          "所有錯誤訊息現在會依照每台手機自己的語言顯示中文或英文，所以掃別人 QR code 加入的朋友，不管主持人用哪種語言，都看得懂發生了什麼事。",
      },
      {
        kind: "better",
        text: "Very long playlists now draw their songs randomly from the whole list instead of always taking the first few hundred, so the same playlist gives you a different game each time.",
        textZh:
          "很長的歌單現在會從整份清單裡隨機抽歌，不再每次都拿最前面那幾百首，所以同一份歌單每次玩到的歌都不一樣。",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-07-30",
    headline:
      "GuessSong 1.0. The party game, Buzzer Mode, Mixed Playlist Mode and the Chinese site are all finished — this release names that rather than adding to it.",
    headlineZh:
      "GuessSong 1.0 正式版。派對遊戲、搶答模式、混合歌單模式、中文版都完成了，這一版是為它們正式定名，而不是又加了什麼。",
    changes: [
      {
        kind: "new",
        text: "This panel. Every release from now on gets a plain-language note here, in English and Chinese, from the footer of any page.",
        textZh:
          "你正在看的這個視窗。從這一版開始，每次更新都會在這裡留下一段人話說明，中英文都有，任何頁面的頁尾都打得開。",
      },
      {
        kind: "better",
        text: "The QR code flow is now measured end to end. A code people scan but fail to get through shows up as something to fix, instead of quietly looking like nobody scanned it.",
        textZh:
          "掃 QR code 加入房間的每一步現在都量得到了。以前有人掃了卻卡在表單上，數字看起來跟沒人掃一模一樣；現在卡住會被看見，才修得到。",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-07-29",
    headline: "Easier to find, and now readable in Chinese.",
    headlineZh: "更好找，而且看得懂中文了。",
    changes: [
      {
        kind: "new",
        text: "A Traditional Chinese version of the site at /zh — written natively rather than machine-translated.",
        textZh: "/zh 的繁體中文版本，是直接用中文寫的，不是機器翻譯過來的。",
      },
      {
        kind: "better",
        text: "The homepage now explains how the game actually works, and answers the six questions people ask most, instead of being a form and one paragraph.",
        textZh:
          "首頁現在會好好說明遊戲怎麼玩，也回答了大家最常問的六個問題，不再只是一個輸入框加一段話。",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-29",
    headline: "Everyone gets a buzzer.",
    headlineZh: "每個人都有一顆搶答鈕。",
    changes: [
      {
        kind: "new",
        text: "Buzzer Mode — every player buzzes in from their own phone, so the host can stop refereeing “who said it first” and actually play. The host buzzes with the space bar.",
        textZh:
          "搶答模式：每個人用自己的手機搶答，主持人不用再當裁判判「誰先講的」，可以真的一起玩。主持人按空白鍵搶答。",
      },
      {
        kind: "new",
        text: "One QR code for everything. Buzzer Mode and Mixed Playlist Mode used to hand out two different codes on two different pages; players now scan once and get both.",
        textZh:
          "一個 QR code 就搞定。以前搶答模式和混合歌單模式會給兩組不同的房間代碼、兩個不同的頁面，現在掃一次兩個都有。",
      },
      {
        kind: "new",
        text: "The host can add their own playlist in Mixed Playlist Mode. They are holding the screen everyone else is scanning, so they could never scan it themselves.",
        textZh:
          "主持人在混合歌單模式裡也能加自己的歌單了。他們拿的正是大家要掃的那塊螢幕，本來根本掃不到自己。",
      },
      {
        kind: "better",
        text: "Buzzing in pauses the clip so the room can hear the answer, and Resume, Stop and Replay stay available until you reveal it.",
        textZh:
          "有人搶答時音樂會自動暫停，大家才聽得到答案；在公布答案之前，繼續播、停止、重播都還按得到。",
      },
      {
        kind: "better",
        text: "A wrong answer passes the question down to whoever buzzed next, instead of ending the round.",
        textZh: "答錯不會直接結束這一題，而是把機會往下傳給下一個搶到的人。",
      },
      {
        kind: "better",
        text: "The room code now appears after the settings, not before them — it is the last step, when it is genuinely time to gather people.",
        textZh:
          "房間代碼現在排在所有設定之後才出現。它是最後一步，等真的要把人叫過來的時候才需要。",
      },
      {
        kind: "fixed",
        text: "Correct and Wrong did nothing at all once the answer had been revealed.",
        textZh: "公布答案之後，「答對」和「答錯」按了完全沒反應。",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-12",
    headline: "Play with everyone's music, not just the host's.",
    headlineZh: "放大家的歌，不只是主持人的歌。",
    changes: [
      {
        kind: "new",
        text: "Mixed Playlist Mode — everyone adds their own playlist, GuessSong merges them into one round and drops the duplicates. Pass the host's phone around, or let people scan a QR code from their own.",
        textZh:
          "混合歌單模式：每個人加自己的歌單，GuessSong 會合成一份並去掉重複的歌。可以把主持人的手機傳一輪，也可以讓大家用自己的手機掃 QR code。",
      },
      {
        kind: "new",
        text: "A bonus point for guessing whose playlist a track came from.",
        textZh: "猜中這首歌是誰的歌單裡的，可以多拿分。",
      },
      {
        kind: "new",
        text: "A shareable Taste Card at the end of a mixed game: the tracks you all had, most obscure taste, and most mainstream.",
        textZh:
          "混合歌單玩完會產生一張可以分享的音樂品味卡：大家都有的歌、品味最冷門的人、最主流的人。",
      },
      {
        kind: "fixed",
        text: "Two players submitting a playlist at the same moment could quietly overwrite each other.",
        textZh: "兩個人同時送出歌單時，其中一份會被默默蓋掉。",
      },
    ],
  },
];

/** The newest release. Used as the `version` on the `changelog_opened` event. */
export const LATEST_VERSION = CHANGELOG[0].version;

/** Pick a change's text for a locale. Keeps the ternary out of the JSX. */
export function changeText(change: ChangelogChange, locale: ChangelogLocale): string {
  return locale === "zh" ? change.textZh : change.text;
}

export function entryHeadline(entry: ChangelogEntry, locale: ChangelogLocale): string {
  return locale === "zh" ? entry.headlineZh : entry.headline;
}

/**
 * Format an ISO date without going through `toLocaleDateString`.
 *
 * The locale-aware formatters resolve against the *runtime's* locale and time
 * zone, which differ between the Node process that prerenders these pages and
 * the browser that hydrates them — React reports that as a hydration mismatch.
 * A fixed table has no such gap.
 */
export function formatChangelogDate(iso: string, locale: ChangelogLocale = "en"): string {
  const [year, month, day] = iso.split("-");
  if (locale === "zh") {
    return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}
