/**
 * The built-in decoy pool for the playlist quiz.
 *
 * Every wrong answer a quiz shows comes from here, and the picker in
 * lib/quiz.ts wants three things of it: real songs by real artists (a made-up
 * title is spotted instantly), enough depth per artist that "another song by
 * the same act" is usually available, and coverage of every script the site's
 * audience listens in — a Mandopop playlist handed three English decoys is a
 * quiz anyone passes by elimination. It is therefore structured as artists ×
 * songs rather than as a list of hits, and the Traditional Chinese half is not
 * an afterthought: that is where most of this site's hosts are.
 *
 * **The artist is Spotify's name, with the native spelling as an alias.**
 * Spotify's API romanises nearly every Chinese and Japanese act — a 周杰倫
 * track arrives credited to "Jay Chou", 五月天 to "Mayday", 米津玄師 to
 * "Kenshi Yonezu" — measured with one artist search per act on 2026-09-14.
 * A pool keyed on the native names matched nothing: the same-artist tier
 * never fired for the audience it was written for, and every question showed
 * one Latin-script artist (the real one) next to three Chinese ones. The
 * canonical name is what the tiers match; the alias is what gets displayed
 * when the playlist itself is in that script (告五人, 吳青峰, 理想混蛋 and
 * 信樂團 are the ones Spotify keeps native).
 *
 * `popularity` is Spotify's 0–100, approximately and from memory. It is only
 * ever compared within `DECOY_POPULARITY_WINDOW`, never shown, so being off by
 * ten costs nothing. The script bucket is *not* stored — `bucketPool` derives
 * it from the strings with the same rule the playlist side uses, so the two
 * cannot disagree.
 *
 * Only imported by the create route. The friend's phone never sees the pool,
 * only the two options a question was built with.
 */

import type { DecoyEntry } from "@/lib/quiz";

type Songs = Array<[title: string, popularity: number]>;

/** `artist(spotifyName, songs)` or `artist(spotifyName, [nativeAlias, …], songs)`. */
function artist(name: string, aliasesOrSongs: readonly string[] | Songs, maybeSongs?: Songs): DecoyEntry[] {
  const aliases = maybeSongs ? (aliasesOrSongs as readonly string[]) : [];
  const songs = (maybeSongs ?? aliasesOrSongs) as Songs;
  return songs.map(([title, popularity]) => ({
    name: title,
    artist: name,
    ...(aliases.length ? { aliases } : {}),
    popularity,
  }));
}

export const QUIZ_DECOY_POOL: readonly DecoyEntry[] = [
  /* ---------------------------------------------------------------- */
  /* 華語                                                              */
  /* ---------------------------------------------------------------- */
  ...artist("Jay Chou", ["周杰倫"], [
    ["晴天", 80], ["七里香", 78], ["稻香", 76], ["告白氣球", 79], ["青花瓷", 74],
    ["夜曲", 75], ["安靜", 72], ["說好不哭", 73], ["簡單愛", 71], ["擱淺", 70],
    ["以父之名", 66], ["不能說的秘密", 69], ["Mojito", 70], ["最偉大的作品", 68],
    ["彩虹", 67], ["園遊會", 66], ["蒲公英的約定", 68], ["聽媽媽的話", 65],
  ]),
  ...artist("Mayday", ["五月天"], [
    ["溫柔", 74], ["突然好想你", 75], ["倔強", 73], ["知足", 72], ["擁抱", 70],
    ["憨人", 66], ["後來的我們", 71], ["乾杯", 69], ["星空", 67], ["你不是真正的快樂", 70],
    ["戀愛ing", 65], ["傷心的人別聽慢歌", 66], ["派對動物", 63], ["志明與春嬌", 64],
  ]),
  ...artist("JJ Lin", ["林俊傑"], [
    ["江南", 73], ["修煉愛情", 74], ["小酒窩", 70], ["不為誰而作的歌", 72], ["她說", 71],
    ["曹操", 66], ["可惜沒如果", 73], ["一千年以後", 68], ["背對背擁抱", 67], ["交換餘生", 70],
  ]),
  ...artist("Hebe Tien", ["田馥甄"], [
    ["小幸運", 76], ["魔鬼中的天使", 70], ["寂寞寂寞就好", 69], ["你就不要想起我", 68],
    ["渺小", 62], ["我想我不會愛你", 61],
  ]),
  ...artist("JOLIN", ["蔡依林", "Jolin Tsai"], [
    ["舞孃", 68], ["日不落", 69], ["玫瑰少年", 70], ["怪美的", 65], ["說愛你", 66],
    ["倒帶", 67], ["大藝術家", 63], ["Play 我呸", 62],
  ]),
  ...artist("A-Mei Chang", ["張惠妹", "A-Mei"], [
    ["聽海", 70], ["記得", 69], ["三天三夜", 65], ["我最親愛的", 68], ["姊妹", 63],
    ["掉了", 64], ["連名帶姓", 66], ["身後", 62],
  ]),
  ...artist("Stefanie Sun", ["孫燕姿"], [
    ["遇見", 73], ["天黑黑", 71], ["我懷念的", 70], ["開始懂了", 67], ["綠光", 66],
    ["逆光", 65], ["克卜勒", 63],
  ]),
  ...artist("Eason Chan", ["陳奕迅"], [
    ["十年", 74], ["富士山下", 72], ["浮誇", 70], ["K歌之王", 69], ["好久不見", 71],
    ["愛情轉移", 72], ["淘汰", 68], ["紅玫瑰", 70], ["孤勇者", 75], ["讓我留在你身邊", 69],
  ]),
  ...artist("Faye Wong", ["王菲"], [
    ["紅豆", 70], ["傳奇", 68], ["匆匆那年", 66], ["容易受傷的女人", 64], ["我願意", 65],
  ]),
  ...artist("G.E.M.", ["鄧紫棋"], [
    ["光年之外", 74], ["泡沫", 72], ["喜歡你", 68], ["倒數", 69], ["來自天堂的魔鬼", 66],
    ["句號", 64],
  ]),
  ...artist("告五人", ["Accusefive"], [
    ["披星戴月的想你", 75], ["愛人錯過", 74], ["唯一", 72], ["帶我去找夜生活", 70],
    ["紅色的美好", 66], ["溫蒂公主的侍衛", 65], ["在這座城市遺失了你", 68],
  ]),
  ...artist("EggPlantEgg", ["茄子蛋"], [
    ["浪子回頭", 74], ["浪流連", 71], ["這款自作多情", 66], ["日常", 60],
  ]),
  ...artist("Crowd Lu", ["盧廣仲"], [
    ["魚仔", 72], ["刻在我心底的名字", 73], ["幾分之幾", 68], ["早安，晨之美！", 60],
    ["大人中", 62],
  ]),
  ...artist("Jonathan Lee", ["李宗盛"], [["山丘", 66], ["鬼迷心竅", 60], ["凡人歌", 58]]),
  ...artist("Jacky Cheung", ["張學友"], [["吻別", 68], ["一路上有你", 64], ["慢慢", 60], ["祝福", 59], ["她來聽我的演唱會", 62]]),
  ...artist("Rene Liu", ["劉若英"], [["後來", 72], ["很愛很愛你", 66], ["為愛痴狂", 60], ["成全", 61]]),
  ...artist("Fish Leong", ["梁靜茹"], [
    ["勇氣", 71], ["寧夏", 67], ["可惜不是你", 69], ["暖暖", 66], ["分手快樂", 65],
    ["會過去的", 60],
  ]),
  ...artist("Eric Chou", ["周興哲"], [
    ["你，好不好？", 73], ["怎麼了", 71], ["以後別做朋友", 69], ["如果雨之後", 68],
    ["永不失聯的愛", 70],
  ]),
  ...artist("Jam Hsiao", ["蕭敬騰"], [["王妃", 66], ["只能想念你", 60], ["讓我為你唱情歌", 58]]),
  ...artist("Rainie Yang", ["楊丞琳"], [["雨愛", 66], ["曖昧", 65], ["年輪說", 64], ["匿名的好友", 60]]),
  ...artist("Yoga Lin", ["林宥嘉"], [["說謊", 70], ["成全", 66], ["想自由", 65], ["浪費", 66], ["天真有邪", 62]]),
  ...artist("WeiBird", ["韋禮安"], [["如果可以", 74], ["因為愛", 62], ["還是會", 63], ["女孩", 60]]),
  ...artist("sodagreen", ["蘇打綠"], [
    ["小情歌", 72], ["小宇宙", 64], ["無與倫比的美麗", 68], ["我好想你", 69], ["下雨的夜晚", 60],
  ]),
  ...artist("No Party For Cao Dong", ["草東沒有派對"], [["大風吹", 68], ["山海", 67], ["爛泥", 65], ["情歌", 60]]),
  ...artist("831", ["八三夭"], [["想見你想見你想見你", 70], ["一事無成的偉大", 62], ["致青春", 58]]),
  ...artist("吳青峰", ["Wu Qing Feng"], [["起風了", 70], ["太空", 60], ["巴別塔慶典", 58]]),
  ...artist("Joker Xue", ["薛之謙"], [["演員", 72], ["醜八怪", 68], ["剛剛好", 67], ["紳士", 64]]),
  ...artist("Mao Buyi", ["毛不易"], [["消愁", 70], ["像我這樣的人", 68], ["不染", 64], ["平凡的一天", 60]]),
  ...artist("Zhou Shen", ["周深"], [["大魚", 68], ["光亮", 62], ["化身孤島的鯨", 60]]),
  ...artist("Cheer Chen", ["陳綺貞"], [["旅行的意義", 68], ["魚", 62], ["太陽", 60], ["還是會寂寞", 58]]),
  ...artist("LaLa Hsu", ["徐佳瑩"], [["身騎白馬", 66], ["言不由衷", 62], ["不難", 60]]),
  ...artist("Ronghao Li", ["李榮浩"], [["年少有為", 72], ["李白", 68], ["模特", 66], ["不將就", 65], ["麻雀", 63]]),
  ...artist("Teresa Teng", ["鄧麗君"], [["月亮代表我的心", 68], ["甜蜜蜜", 66], ["我只在乎你", 64]]),
  ...artist("Wu Bai", ["伍佰"], [["挪威的森林", 66], ["突然的自我", 65], ["浪人情歌", 62], ["Last Dance", 70]]),
  ...artist("Waa Wei", ["魏如萱"], [["你啊你啊", 66], ["星期三或禮拜三", 60], ["還是要相信愛情啊混蛋們", 62]]),
  ...artist("Eve Ai", ["艾怡良"], [["Forever Young", 64], ["給朋友", 58], ["我這個人", 57]]),
  ...artist("Good Band", ["好樂團"], [["他們說我是沒有用的年輕人", 64], ["我們一樣可惜", 58]]),
  ...artist("理想混蛋", ["Bestards"], [["愚者", 66], ["不是因為天氣晴朗才愛你", 64], ["行星", 58]]),
  ...artist("Mixer", ["麋先生"], [["馬戲團運動", 62], ["嗜睡症", 56]]),
  ...artist("Power Station", ["動力火車"], [["當", 64], ["忠孝東路走九遍", 62], ["艾琳娜", 56]]),
  ...artist("信樂團", ["Shin"], [["死了都要愛", 62], ["離歌", 60]]),
  ...artist("Zhang Zhen Yue", ["張震嶽"], [["愛我別走", 64], ["再見", 63], ["思念是一種病", 62]]),
  ...artist("Karen Mok", ["莫文蔚"], [["陰天", 62], ["慢慢喜歡你", 66], ["愛", 60]]),
  ...artist("Khalil Fong", ["方大同"], [["特別的人", 64], ["愛愛愛", 60], ["三人遊", 58]]),
  ...artist("Soft Lipa", ["蛋堡"], [["史詩", 58], ["踩...腳踏車", 56]]),
  ...artist("Cosmos People", ["宇宙人"], [["一起去跑步", 58], ["飛翔", 56]]),
  ...artist("Yisa Yu", ["郁可唯"], [["路過人間", 62], ["指望", 58]]),
  ...artist("Ronald Cheng", ["鄭中基"], [["無賴", 60], ["我代你哭", 55]]),

  /* ---------------------------------------------------------------- */
  /* 日本語                                                            */
  /* ---------------------------------------------------------------- */
  ...artist("YOASOBI", [["夜に駆ける", 80], ["アイドル", 82], ["群青", 74], ["怪物", 73], ["ハルジオン", 66]]),
  ...artist("Kenshi Yonezu", ["米津玄師"], [["Lemon", 80], ["KICK BACK", 78], ["パプリカ", 66], ["感電", 70], ["LOSER", 68], ["灰色と青", 65]]),
  ...artist("OFFICIAL HIGE DANDISM", ["Official髭男dism"], [["Pretender", 79], ["I LOVE...", 74], ["Subtitle", 77], ["宿命", 68], ["ミックスナッツ", 75]]),
  ...artist("King Gnu", [["白日", 76], ["一途", 70], ["SPECIALZ", 73], ["カメレオン", 66]]),
  ...artist("Aimyon", ["あいみょん"], [["マリーゴールド", 77], ["裸の心", 70], ["君はロックを聴かない", 72], ["愛を伝えたいだとか", 68]]),
  ...artist("Ado", [["うっせぇわ", 74], ["新時代", 78], ["唱", 76], ["踊", 70]]),
  ...artist("back number", [["高嶺の花子さん", 70], ["クリスマスソング", 68], ["水平線", 72], ["HAPPY BIRTHDAY", 66]]),
  ...artist("Mrs. GREEN APPLE", [["青と夏", 74], ["ケセラセラ", 76], ["ダンスホール", 72], ["インフェルノ", 70], ["ライラック", 78]]),
  ...artist("Fujii Kaze", ["藤井風"], [["きらり", 74], ["死ぬのがいいわ", 76], ["何なんw", 66], ["grace", 68]]),
  ...artist("Gen Hoshino", ["星野源"], [["恋", 72], ["SUN", 64], ["ドラえもん", 62], ["不思議", 60]]),
  ...artist("Vaundy", [["怪獣の花唄", 74], ["踊り子", 72], ["napori", 64]]),
  ...artist("Aimer", [["カタオモイ", 70], ["残響散歌", 74], ["蝶々結び", 62]]),
  ...artist("RADWIMPS", [["前前前世", 74], ["スパークル", 70], ["なんでもないや", 68]]),
  ...artist("ONE OK ROCK", [["Wherever you are", 72], ["The Beginning", 68], ["完全感覚Dreamer", 64]]),
  ...artist("LiSA", [["紅蓮華", 76], ["炎", 74], ["unlasting", 60]]),
  ...artist("Hikaru Utada", ["宇多田ヒカル"], [["First Love", 74], ["Automatic", 64], ["花束を君に", 62], ["One Last Kiss", 70]]),
  ...artist("Creepy Nuts", [["Bling-Bang-Bang-Born", 80], ["のびしろ", 60]]),

  /* ---------------------------------------------------------------- */
  /* 한국어 — titles as Spotify lists them, mostly Latin script         */
  /* ---------------------------------------------------------------- */
  ...artist("BTS", [["Dynamite", 82], ["Butter", 80], ["Boy With Luv", 76], ["봄날", 72], ["DNA", 72], ["Fake Love", 71]]),
  ...artist("BLACKPINK", [["DDU-DU DDU-DU", 78], ["How You Like That", 78], ["Kill This Love", 76], ["Pink Venom", 74], ["Shut Down", 72]]),
  ...artist("NewJeans", [["Ditto", 80], ["Hype Boy", 82], ["Super Shy", 80], ["OMG", 78], ["Attention", 76]]),
  ...artist("IVE", [["LOVE DIVE", 78], ["I AM", 76], ["After LIKE", 76], ["ELEVEN", 72]]),
  ...artist("aespa", [["Next Level", 74], ["Supernova", 78], ["Spicy", 72], ["Savage", 70]]),
  ...artist("IU", [["Blueming", 76], ["Celebrity", 74], ["좋은 날", 70], ["Love wins all", 72], ["밤편지", 72], ["Palette", 68]]),
  ...artist("LE SSERAFIM", [["ANTIFRAGILE", 76], ["UNFORGIVEN", 72], ["FEARLESS", 70], ["Perfect Night", 74]]),
  ...artist("SEVENTEEN", [["Super", 74], ["HOT", 70], ["아주 NICE", 66]]),
  ...artist("Stray Kids", [["神메뉴", 74], ["MANIAC", 72], ["S-Class", 72]]),
  ...artist("TWICE", [["TT", 72], ["FANCY", 74], ["Feel Special", 72], ["The Feels", 70]]),
  ...artist("Red Velvet", [["Psycho", 74], ["Bad Boy", 70], ["빨간 맛", 66]]),
  ...artist("BIGBANG", [["뱅뱅뱅", 70], ["FANTASTIC BABY", 70], ["봄여름가을겨울", 72]]),
  ...artist("PSY", [["Gangnam Style", 74], ["That That", 66]]),
  ...artist("(G)I-DLE", [["Queencard", 74], ["TOMBOY", 72], ["Nxde", 70]]),
  ...artist("Jung Kook", [["Seven", 84], ["Standing Next to You", 80], ["3D", 76]]),
  ...artist("Jimin", [["Like Crazy", 80], ["Who", 78]]),
  ...artist("EXO", [["Love Shot", 72], ["으르렁", 66], ["Ko Ko Bop", 64]]),
  ...artist("DAY6", [["예뻤어", 70], ["한 페이지가 될 수 있게", 72], ["Zombie", 66]]),
  ...artist("AKMU", [["어떻게 이별까지 사랑하겠어, 널 사랑하는 거지", 72], ["Love Lee", 66]]),

  /* ---------------------------------------------------------------- */
  /* Latin script                                                      */
  /* ---------------------------------------------------------------- */
  ...artist("Adele", [["Hello", 78], ["Rolling in the Deep", 80], ["Someone Like You", 80], ["Easy On Me", 78], ["Set Fire to the Rain", 76]]),
  ...artist("Taylor Swift", [["Shake It Off", 78], ["Blank Space", 80], ["Love Story", 78], ["Anti-Hero", 82], ["Cruel Summer", 88], ["cardigan", 78], ["Style", 76]]),
  ...artist("Ed Sheeran", [["Shape of You", 84], ["Perfect", 84], ["Thinking Out Loud", 78], ["Photograph", 80], ["Bad Habits", 76]]),
  ...artist("The Weeknd", [["Blinding Lights", 88], ["Starboy", 84], ["Save Your Tears", 82], ["Can't Feel My Face", 76], ["The Hills", 78], ["Die For You", 82]]),
  ...artist("Billie Eilish", [["bad guy", 80], ["ocean eyes", 76], ["Happier Than Ever", 78], ["everything i wanted", 78], ["lovely", 84], ["BIRDS OF A FEATHER", 90]]),
  ...artist("Bruno Mars", [["Uptown Funk", 80], ["Just the Way You Are", 82], ["Grenade", 76], ["24K Magic", 74], ["Locked Out of Heaven", 80]]),
  ...artist("Coldplay", [["Yellow", 84], ["Viva La Vida", 84], ["Fix You", 80], ["The Scientist", 82], ["Paradise", 78], ["Sparks", 80]]),
  ...artist("Dua Lipa", [["Levitating", 80], ["Don't Start Now", 80], ["New Rules", 76], ["Physical", 72], ["Houdini", 76]]),
  ...artist("Harry Styles", [["As It Was", 84], ["Watermelon Sugar", 82], ["Adore You", 76], ["Sign of the Times", 78]]),
  ...artist("Olivia Rodrigo", [["drivers license", 78], ["good 4 u", 80], ["vampire", 78], ["deja vu", 76], ["traitor", 76]]),
  ...artist("Justin Bieber", [["Sorry", 76], ["Love Yourself", 78], ["Peaches", 78], ["Baby", 74], ["Ghost", 74]]),
  ...artist("Ariana Grande", [["thank u, next", 76], ["7 rings", 78], ["Into You", 76], ["positions", 74], ["we can't be friends", 80]]),
  ...artist("Post Malone", [["Circles", 82], ["Sunflower", 84], ["rockstar", 78], ["Congratulations", 76], ["I Had Some Help", 80]]),
  ...artist("Drake", [["God's Plan", 80], ["Hotline Bling", 78], ["One Dance", 82], ["In My Feelings", 74], ["Passionfruit", 76]]),
  ...artist("Imagine Dragons", [["Believer", 84], ["Radioactive", 80], ["Thunder", 80], ["Demons", 78], ["Bones", 76]]),
  ...artist("Maroon 5", [["Sugar", 80], ["Moves Like Jagger", 78], ["Girls Like You", 78], ["Payphone", 76], ["Memories", 78]]),
  ...artist("Lady Gaga", [["Bad Romance", 80], ["Poker Face", 78], ["Shallow", 80], ["Just Dance", 74], ["Die With A Smile", 92]]),
  ...artist("Rihanna", [["Diamonds", 80], ["Umbrella", 78], ["We Found Love", 76], ["Stay", 76], ["Only Girl (In The World)", 74]]),
  ...artist("Beyoncé", [["Halo", 78], ["Crazy in Love", 76], ["Single Ladies (Put a Ring on It)", 74], ["TEXAS HOLD 'EM", 76]]),
  ...artist("Katy Perry", [["Firework", 76], ["Roar", 76], ["Teenage Dream", 76], ["Dark Horse", 74], ["Last Friday Night (T.G.I.F.)", 72]]),
  ...artist("Sia", [["Chandelier", 78], ["Cheap Thrills", 76], ["Elastic Heart", 72], ["Unstoppable", 82]]),
  ...artist("Sam Smith", [["Stay With Me", 78], ["Too Good at Goodbyes", 76], ["I'm Not the Only One", 80], ["Unholy", 80]]),
  ...artist("Shawn Mendes", [["Stitches", 74], ["Treat You Better", 76], ["Señorita", 80], ["There's Nothing Holdin' Me Back", 78]]),
  ...artist("Charlie Puth", [["Attention", 78], ["We Don't Talk Anymore", 78], ["One Call Away", 74], ["Left and Right", 76]]),
  ...artist("Eminem", [["Lose Yourself", 84], ["Without Me", 84], ["Love The Way You Lie", 80], ["Rap God", 78], ["Mockingbird", 86]]),
  ...artist("Kendrick Lamar", [["HUMBLE.", 82], ["DNA.", 78], ["Not Like Us", 86], ["Money Trees", 82], ["luther", 88]]),
  ...artist("SZA", [["Kill Bill", 84], ["Snooze", 82], ["Good Days", 78], ["Saturn", 80]]),
  ...artist("Doja Cat", [["Say So", 76], ["Kiss Me More", 74], ["Paint The Town Red", 80], ["Woman", 78]]),
  ...artist("Lana Del Rey", [["Summertime Sadness", 82], ["Young And Beautiful", 82], ["Video Games", 78], ["Say Yes To Heaven", 78]]),
  ...artist("Radiohead", [["Creep", 84], ["Karma Police", 78], ["No Surprises", 80], ["Let Down", 74]]),
  ...artist("Oasis", [["Wonderwall", 84], ["Don't Look Back In Anger", 80], ["Champagne Supernova", 78], ["Live Forever", 74]]),
  ...artist("Queen", [["Bohemian Rhapsody", 84], ["Don't Stop Me Now", 84], ["We Will Rock You", 80], ["Somebody To Love", 78], ["Under Pressure", 78]]),
  ...artist("The Beatles", [["Hey Jude", 78], ["Let It Be", 78], ["Here Comes The Sun", 84], ["Yesterday", 76], ["Come Together", 78]]),
  ...artist("Michael Jackson", [["Billie Jean", 84], ["Beat It", 80], ["Thriller", 76], ["Smooth Criminal", 76], ["Rock with You", 76]]),
  ...artist("Nirvana", [["Smells Like Teen Spirit", 84], ["Come As You Are", 80], ["Heart-Shaped Box", 74]]),
  ...artist("Arctic Monkeys", [["Do I Wanna Know?", 86], ["505", 84], ["R U Mine?", 78], ["I Wanna Be Yours", 88]]),
  ...artist("The 1975", [["Somebody Else", 76], ["Chocolate", 72], ["About You", 82]]),
  ...artist("Tame Impala", [["The Less I Know The Better", 86], ["Let It Happen", 78], ["Borderline", 74]]),
  ...artist("Daft Punk", [["Get Lucky", 78], ["One More Time", 80], ["Instant Crush", 82]]),
  ...artist("Avicii", [["Wake Me Up", 82], ["Levels", 78], ["The Nights", 84], ["Waiting For Love", 78]]),
  ...artist("Calvin Harris", [["Summer", 76], ["This Is What You Came For", 78], ["Feels", 76], ["One Kiss", 80]]),
  ...artist("The Chainsmokers", [["Closer", 80], ["Don't Let Me Down", 78], ["Something Just Like This", 82]]),
  ...artist("Elton John", [["Rocket Man", 78], ["Your Song", 78], ["Tiny Dancer", 78], ["I'm Still Standing", 76]]),
  ...artist("Whitney Houston", [["I Will Always Love You", 78], ["I Wanna Dance with Somebody", 80], ["How Will I Know", 72]]),
  ...artist("Mariah Carey", [["All I Want for Christmas Is You", 80], ["Hero", 70], ["We Belong Together", 72]]),
  ...artist("Frank Ocean", [["Thinkin Bout You", 80], ["Pink + White", 84], ["Nights", 82], ["Ivy", 82]]),
  ...artist("Hozier", [["Take Me To Church", 84], ["Too Sweet", 86], ["Cherry Wine", 76]]),
  ...artist("Lewis Capaldi", [["Someone You Loved", 86], ["Before You Go", 82], ["Bruises", 74]]),
  ...artist("Glass Animals", [["Heat Waves", 84], ["Gooey", 74]]),
  ...artist("Miley Cyrus", [["Flowers", 82], ["Wrecking Ball", 78], ["Party In The U.S.A.", 78], ["The Climb", 72]]),
  ...artist("Sabrina Carpenter", [["Espresso", 88], ["Please Please Please", 86], ["Taste", 84], ["Nonsense", 78]]),
  ...artist("Chappell Roan", [["Good Luck, Babe!", 86], ["Pink Pony Club", 84], ["HOT TO GO!", 80]]),
  ...artist("Benson Boone", [["Beautiful Things", 88], ["Slow It Down", 74]]),
  ...artist("Teddy Swims", [["Lose Control", 88], ["The Door", 74]]),
  ...artist("Bad Bunny", [["Tití Me Preguntó", 82], ["DÁKITI", 80], ["Me Porto Bonito", 82], ["DtMF", 90]]),
  ...artist("Shakira", [["Hips Don't Lie", 82], ["Waka Waka (This Time for Africa)", 76], ["Whenever, Wherever", 76]]),
  ...artist("Cigarettes After Sex", [["Apocalypse", 86], ["K.", 80], ["Nothing's Gonna Hurt You Baby", 82]]),
  ...artist("Mitski", [["My Love Mine All Mine", 86], ["Nobody", 78], ["Washing Machine Heart", 78]]),
  ...artist("Laufey", [["From The Start", 80], ["Valentine", 76], ["Promise", 72]]),
  ...artist("Conan Gray", [["Heather", 82], ["Maniac", 76], ["Memories", 72]]),
  ...artist("Lorde", [["Royals", 78], ["Ribs", 78], ["Green Light", 74]]),
  ...artist("Twenty One Pilots", [["Stressed Out", 82], ["Heathens", 80], ["Ride", 78]]),
  ...artist("Bon Iver", [["Skinny Love", 74], ["Holocene", 76], ["Flume", 68]]),
  ...artist("John Mayer", [["New Light", 78], ["Gravity", 76], ["Slow Dancing in a Burning Room", 78]]),
  ...artist("Keane", [["Somewhere Only We Know", 84], ["Everybody's Changing", 76]]),
  ...artist("Green Day", [["Boulevard of Broken Dreams", 80], ["Basket Case", 78], ["Wake Me Up When September Ends", 78]]),
  ...artist("Linkin Park", [["In the End", 84], ["Numb", 84], ["Crawling", 74]]),
  ...artist("Red Hot Chili Peppers", [["Californication", 82], ["Under the Bridge", 80], ["Can't Stop", 80]]),
  ...artist("Fleetwood Mac", [["Dreams", 84], ["The Chain", 78], ["Go Your Own Way", 78]]),
];
