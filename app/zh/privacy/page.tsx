import type { Metadata } from "next";
import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { CONTACT_EMAIL } from "@/lib/contact";
import { POLICY_LAST_UPDATED_ZH } from "@/lib/legal";

export const metadata: Metadata = {
  title: "隱私權政策",
  description:
    "GuessSong 會存什麼、不存什麼，以及有哪些第三方服務參與。這個遊戲沒有帳號、不用登入，遊戲進度留在你自己的瀏覽器裡。",
  alternates: {
    canonical: "/zh/privacy",
    languages: { en: "/privacy", "zh-TW": "/zh/privacy", "x-default": "/privacy" },
  },
};

export default function ZhPrivacyPage() {
  return (
    <ArticleShell
      eyebrow="法律資訊"
      title="隱私權政策"
      lede="GuessSong 沒有帳號、不用登入、也沒有使用者檔案。這一頁說明真正會被存下來的東西是什麼、存多久，以及還有誰參與其中。"
      meta={`最後更新 ${POLICY_LAST_UPDATED_ZH} · 營運者 GuessSong · ${CONTACT_EMAIL}`}
      locale="zh"
      backHref="/zh"
      backLabel="← 回到 GuessSong"
    >
      <div className="callout">
        <p className="callout-title">先講結論</p>
        <p>
          我們從來不問你是誰。你的遊戲內容 —— 歌單、玩家名字、分數 —— 都由你自己的瀏覽器保管，關掉分頁就消失。
          真正會送到伺服器的只有三件事：一個歌單連結（用來讀出曲目）、歌名和歌手（用來找試聽片段），
          以及你如果開了混合歌單模式，一個幾小時內就會自動刪除的房間。
          本站有執行 Google AdSense 廣告和 Google Analytics，兩者會依各自的政策設置 Cookie。
        </p>
      </div>

      <h2>我們是誰</h2>
      <p>
        GuessSong 是一個免費的開源團康遊戲，網址是 <code>www.guessong.app</code>。
        原始碼公開在{" "}
        <a href="https://github.com/Waynting/GuessSong" target="_blank" rel="noopener noreferrer">
          github.com/Waynting/GuessSong
        </a>
        ，所以這一頁講的每一句話都可以直接對照程式碼檢查。任何隱私相關問題請寄到{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。
      </p>

      <h2>這裡沒有帳號</h2>
      <p>
        沒有註冊、沒有登入、沒有密碼，也沒有任何一步要你授權 Spotify。
        我們不知道你的名字、Email 或 Spotify 身分，因為網站從來不問，也沒有地方可以放。
        這裡沒有使用者資料庫。
      </p>

      <h2>留在你瀏覽器裡的東西</h2>
      <p>
        進行中的遊戲存在你裝置的 <strong>session storage</strong> —— 一個瀏覽器在你關掉分頁時就會清掉的空間。
        裡面是從你貼上的歌單抓出來的曲目、你輸入的玩家名字、你選的片段長度，以及當下的分數。這些從來不會傳給我們。
      </p>
      <p>
        網站也會用 <strong>local storage</strong> 記一些小設定，例如你是不是已經看過這一版的更新說明。
        清除本站的瀏覽資料就會一起清掉。
      </p>

      <h2>會送到伺服器的東西</h2>
      <h3>讀取歌單</h3>
      <p>
        當你貼上 Spotify 歌單連結時，這個連結會送到我們的伺服器，由伺服器去問 Spotify 的公開 Web API
        要歌單名稱和曲目清單。我們用的是 Spotify 的 <em>Client Credentials</em> 流程，
        這個流程驗證的是<em>這個應用程式</em>而不是你：Spotify 完全不會知道是誰在問，
        我們也拿不到你的 Spotify 帳號、收藏或聽歌紀錄。抓回來的曲目清單會以歌單 ID 為鍵在我們這邊快取幾小時，
        避免同一個熱門歌單被重複抓取。
      </p>

      <h3>尋找試聽片段</h3>
      <p>
        Spotify 在 2024 年底停止提供大部分歌曲的試聽片段，所以針對每一首歌，
        網站會把<strong>歌名和歌手名稱</strong>送到 iTunes Search API，找不到的話再送到 Deezer，
        用來找出 30 秒的試聽片段。送出去的就只有歌名和歌手。
        結果會以曲目 ID 快取起來，包括「哪裡都沒有片段」這種結果。
      </p>

      <h3>混合歌單模式的房間</h3>
      <p>
        如果你建立房間讓其他人用手機交出自己的歌單，我們會在一個暫存的鍵值資料庫裡存下：
        房間代碼、玩家自己輸入的顯示名稱，以及從他們提交的歌單抓出來的曲目清單。
        這筆紀錄從建立的那一刻就帶著到期時間，時間一到就自動刪除；
        設計上它也只會被消耗一次，就是主持人開始遊戲的時候。
        如果你不希望自己的本名出現在裡面，輸入暱稱就好。
      </p>

      <h3>搶答器房間</h3>
      <p>
        搶答器模式跑在 Cloudflare Durable Objects 上，只在房間存在期間保留房內的玩家名字和誰先按。
        房間結束後什麼都不留。
      </p>

      <h3>流量限制與濫用防護</h3>
      <p>
        為了避免單一訪客把我們跟 Spotify、iTunes 共用的額度用光，
        伺服器會在很短的固定時間窗內以 <strong>IP 位址</strong>為單位計算請求次數。
        存下來的東西是一個對應到該位址的計數器，只保留那個時間窗的長度（幾分鐘）然後就消失。
        我們不會拿它建立任何個人檔案，也不會用它辨識任何人。
      </p>

      <h3>伺服器日誌</h3>
      <p>
        我們的主機服務商 Vercel 會在營運過程中記錄標準的請求日誌（時間、路徑、回應狀態、IP 位址、瀏覽器識別字串）。
        這些由 Vercel 依其自身政策保存，只用於除錯與安全用途。
      </p>

      <h2>計數，而不是追蹤</h2>
      <p>
        我們會保留一小組彙總計數 —— 每天開了幾場遊戲、有多少人是從分享連結進來的 —— 就是單純的數字。
        它們沒有附帶任何識別資訊，無法回推到某個人或某台裝置。
      </p>

      <h2>第三方、Cookie 與廣告</h2>
      <p>本站執行三個 Google 服務，各自依照自己的政策設置 Cookie 或類似的識別技術：</p>
      <ul>
        <li>
          <strong>Google AdSense</strong> 負責本站的廣告。Google 及其合作夥伴可能會使用 Cookie，
          根據你先前造訪本站和其他網站的紀錄來投放廣告。
        </li>
        <li>
          <strong>Google Analytics 4</strong> 提供彙總的使用統計 —— 瀏覽次數、哪些功能被使用、發生了哪些錯誤。
          失敗原因一律記成固定的分類代碼，絕不記成原始文字，所以你貼上或輸入的內容不會被送進 Analytics。
        </li>
        <li>
          <strong>Google Fonts</strong> 提供本站使用的兩套字體。
        </li>
      </ul>
      <p>
        Google 使用廣告 Cookie，讓 Google 及其合作夥伴能根據你造訪本站及網路上其他網站的紀錄向你放送廣告。
        你可以到{" "}
        <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
          Google 廣告設定
        </a>
        {" "}停用個人化廣告，或到{" "}
        <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
          aboutads.info/choices
        </a>
        {" "}停用第三方供應商為了個人化廣告而使用的 Cookie。Google 自身的資料處理方式說明於其{" "}
        <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
          隱私權與條款
        </a>
        。
      </p>
      <p>
        除此之外，我們如前所述依賴 Spotify、Apple（iTunes Search）、Deezer、Vercel、Upstash 與 Cloudflare。
        我們不販售也不分享個人資訊 —— 這裡本來就沒有個人資訊可賣。
      </p>

      <h2>歐洲經濟區、英國與瑞士的訪客</h2>
      <p>
        在需要合法處理依據時，讓遊戲能運作的技術性處理（讀取歌單與試聽片段、流量限制、伺服器日誌）
        我們依據<strong>正當利益</strong>；廣告與分析 Cookie 則依據<strong>同意</strong>，
        在適用的情況下透過 Google 的同意機制取得。
        你有權要求存取、更正、刪除、限制處理你的個人資料，或對處理提出反對，也有權向當地的監理機關申訴。
        由於我們沒有帳號制度，多數情況下我們手上根本沒有可以回覆或刪除的資料 —— 但你寄信來，我們會明確這樣告訴你。
      </p>

      <h2>加州訪客</h2>
      <p>
        依 CCPA/CPRA 對這些詞的定義，我們不販售個人資訊，也不為了跨情境行為廣告而分享個人資訊。
        要行使任何 CCPA 權利，請透過下方的聯絡方式與我們聯繫。
      </p>

      <h2>兒童</h2>
      <p>
        GuessSong 是面向一般大眾的遊戲，並非針對 13 歲以下兒童設計。我們不會刻意蒐集兒童的個人資訊。
        如果你認為有兒童透過混合歌單房間提交了個人資訊，請告訴我們，我們會移除 ——
        另外也請注意，這些房間無論如何都會在數小時內自行到期刪除。
      </p>

      <h2>政策變更</h2>
      <p>
        如果這份政策有實質變更，頁面上方的日期會跟著更新。頁尾連結的更新說明會記錄變更的時間點。
      </p>

      <h2>聯絡方式</h2>
      <p>
        疑問、請求與申訴：<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。
        <Link href="/contact">聯絡頁面</Link>有更完整的聯絡說明。
      </p>

      <div className="article-cta">
        <p>沒有東西要註冊。貼上歌單就能開始。</p>
        <Link href="/zh" className="cta-primary">
          開始遊戲 →
        </Link>
      </div>
    </ArticleShell>
  );
}
