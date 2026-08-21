import type { Metadata } from "next";
import Link from "next/link";
import { ArticleShell } from "@/components/article-shell";
import { CONTACT_EMAIL } from "@/lib/contact";
import { POLICY_LAST_UPDATED_ZH } from "@/lib/legal";

export const metadata: Metadata = {
  title: "服務條款",
  description:
    "使用 GuessSong 即代表你接受的條款：這個遊戲是什麼、不是什麼、它和 Spotify／iTunes／Deezer 的關係，以及服務的限制。",
  alternates: {
    canonical: "/zh/terms",
    languages: { en: "/terms", "zh-TW": "/zh/terms" },
  },
};

export default function ZhTermsPage() {
  return (
    <ArticleShell
      eyebrow="法律資訊"
      title="服務條款"
      lede="GuessSong 是免費的開源團康遊戲，以現狀提供。以下是你使用它時所接受的條款。"
      meta={`最後更新 ${POLICY_LAST_UPDATED_ZH} · ${CONTACT_EMAIL}`}
      locale="zh"
      backHref="/zh"
      backLabel="← 回到 GuessSong"
    >
      <h2>1. 這個服務是什麼</h2>
      <p>
        GuessSong 是一個免費、在瀏覽器裡跑的團康遊戲。你給它一個公開 Spotify 歌單的連結，
        它會讀出這個歌單的曲目、幫每首歌找到一段公開的試聽片段，然後播出來讓在場的人猜歌名。
        沒有東西要安裝、沒有帳號要註冊，也不收費。
      </p>
      <p>使用本站即表示你同意這些條款。如果你不同意，請不要使用本站。</p>

      <h2>2. 我們不是 Spotify</h2>
      <p>
        <strong>
          GuessSong 是獨立專案，與 Spotify AB、Apple Inc.、Deezer S.A. 沒有任何從屬、背書、
          贊助或認證關係。
        </strong>{" "}
        Spotify、iTunes 和 Deezer 是各自所有權人的商標，在此僅用於說明本遊戲讀取資料的來源。
      </p>
      <p>
        本站透過 Spotify 的公開 Web API 讀取公開歌單的中繼資料，
        並透過公開的 iTunes Search API 與 Deezer 公開 API 取得試聽片段。
        本站不下載、不儲存、不代管、也不重新散布任何音樂。
        片段是直接從代管它的服務串流播放，該服務自己的條款適用於這段播放行為。
        我們不移除、不繞過、也不干擾任何技術保護措施。
      </p>

      <h2>3. 可接受的使用方式</h2>
      <p>你同意不會：</p>
      <ul>
        <li>將本站用於任何不法目的，或以任何侵害他人權利的方式使用；</li>
        <li>
          提交你無權分享的歌單連結，或提交不法、辱罵、仇恨性的內容 ——
          這包含在混合歌單房間裡輸入的顯示名稱，因為其他玩家會看到；
        </li>
        <li>
          以自動化、爬取或其他方式送出足以影響其他人使用的請求量，
          或試圖繞過為此而設的流量限制；
        </li>
        <li>試圖未經授權存取本站、其基礎架構，或其他主持人建立的房間，包括猜測房間代碼；</li>
        <li>
          以需要你並未持有之授權的方式，利用本站重製、公開演出或散布音樂。
          朋友間的私人遊戲夜和公開演出是兩回事，而只有你知道自己在辦哪一種。
        </li>
      </ul>

      <h2>4. 房間與玩家提交的內容</h2>
      <p>
        混合歌單模式讓其他人可以把歌單連結和顯示名稱提交到你主持的房間。
        那些內容屬於提交者本人，我們不主張其所有權，也不進行審核。
        房間是暫時的，會自動到期。如果房間裡出現不當內容，主持人直接結束遊戲即可 ——
        而房間無論如何都會自行刪除。
      </p>

      <h2>5. 可用性，以及會壞掉的地方</h2>
      <p>
        本服務以<strong>「現狀」及「現有可用」</strong>基礎提供，不提供任何明示或默示的擔保，
        包括適售性、特定目的適用性與不侵權。以下是我們已知的失敗情況，先誠實講清楚：
      </p>
      <ul>
        <li>有些歌曲在任何地方都找不到試聽片段而會被跳過，所以實際播出的歌可能比歌單裡的少；</li>
        <li>Spotify 的官方編輯精選歌單完全讀不到，私人歌單或有地區限制的歌單也會失敗；</li>
        <li>本站依賴的上游服務有自己的流量限制，當它們拒絕請求時，遊戲也會跟著失敗；</li>
        <li>我們可能隨時變更、暫停或終止服務的任何部分，恕不另行通知。</li>
      </ul>
      <p>我們不保證服務不中斷、即時、安全或無錯誤。</p>

      <h2>6. 責任限制</h2>
      <p>
        在法律允許的最大範圍內，GuessSong 及其維護者對於你使用或無法使用本服務所生的
        任何間接、附隨、特殊、衍生或懲罰性損害，或任何資料、利潤或商譽的損失，均不負責。
        由於本服務免費提供，我們對你的責任總額以你為它支付的金額為上限，也就是零。
      </p>
      <p>
        本條款不排除或限制依法不得排除或限制的責任，
        包括因過失導致死亡或人身傷害的責任，以及詐欺責任。
      </p>

      <h2>7. 程式碼與其授權</h2>
      <p>
        GuessSong 的原始碼以 MIT 授權公開於{" "}
        <a href="https://github.com/Waynting/GuessSong" target="_blank" rel="noopener noreferrer">
          github.com/Waynting/GuessSong
        </a>
        。該授權規範的是程式碼本身，並未授予 GuessSong 名稱、
        遊戲播放的音樂，或程式碼所連接的任何第三方服務之任何權利 ——
        而規範你使用這個網站的是本條款，不是該授權。
      </p>

      <h2>8. 隱私與廣告</h2>
      <p>
        <Link href="/zh/privacy">隱私權政策</Link>構成本條款的一部分，
        說明本站會存下什麼以及有哪些第三方參與。本站刊登由 Google AdSense 投放的廣告。
      </p>

      <h2>9. 變更</h2>
      <p>
        我們可能更新本條款。頁面上方的日期記錄最後一次變更的時間，
        變更後繼續使用本站即表示你接受更新後的條款。
      </p>

      <h2>10. 聯絡方式</h2>
      <p>
        關於本條款的疑問，或針對本站內容的權利申訴：
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。
        我們會盡快處理有依據的下架請求 —— 需要附上哪些資訊，請見
        <Link href="/contact">聯絡頁面</Link>。
      </p>

      <div className="article-cta">
        <p>文件看完了，遊戲比較好玩。</p>
        <Link href="/zh" className="cta-primary">
          開始遊戲 →
        </Link>
      </div>
    </ArticleShell>
  );
}
