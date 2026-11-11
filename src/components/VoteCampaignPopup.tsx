import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { trackEvent } from "../lib/analytics"

const VOTE_URL = "https://vnexpress.net/giai-tri/vietnam-icontent/binh-chon"
const DISMISSED_KEY = "hnx-icontent-vote-popup-dismissed"

export function VoteCampaignPopup() {
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const isPublicPage = !location.pathname.startsWith("/admin") && location.pathname !== "/dat-lai-mat-khau"

  useEffect(() => {
    if (!isPublicPage || window.sessionStorage.getItem(DISMISSED_KEY) === "true") return
    const timer = window.setTimeout(() => setIsOpen(true), 900)
    return () => window.clearTimeout(timer)
  }, [isPublicPage])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_KEY, "true")
    setIsOpen(false)
  }

  const handleVote = () => {
    trackEvent("click_icontent_vote", { click_location: "campaign_popup" })
    dismiss()
  }

  if (!isOpen) return null

  const baseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`

  return (
    <div
      className="vote-popup-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <section
        className="vote-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-popup-title"
        aria-describedby="vote-popup-description"
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="vote-popup-close"
          aria-label="Đóng lời mời bình chọn"
          onClick={dismiss}
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="vote-popup-visual">
          <img
            className="vote-popup-photo"
            src={`${baseUrl}source/vote/hanoi-xanh-icontent-vote.png`}
            alt="Poster bình chọn Hà Nội Xanh tại chung kết Vietnam iContent Awards 2026"
          />
        </div>

        <div className="vote-popup-content">
          <div className="vote-popup-kicker">
            <span aria-hidden="true">✦</span>
            SỐNG RỰC RỠ · VIETNAM ICONTENT AWARDS
          </div>
          <h2 id="vote-popup-title">Cùng bình chọn cho<br /><em>Hà Nội Xanh</em> nhé!</h2>
          <p id="vote-popup-description" className="vote-popup-description">
            Mỗi lượt bình chọn là một lời động viên để hành trình bảo vệ môi trường của chúng mình đi xa hơn.
          </p>

          <div className="vote-popup-category">
            <span>HẠNG MỤC BÌNH CHỌN</span>
            <strong><i aria-hidden="true">♥</i> Tổ chức vì cộng đồng</strong>
            <small>Chọn hạng mục, tìm “Hà Nội Xanh” và bình chọn trước 12h ngày 23/11.</small>
          </div>

          <div className="vote-popup-actions">
            <a
              className="vote-popup-primary"
              href={VOTE_URL}
              target="_blank"
              rel="noreferrer noopener"
              onClick={handleVote}
            >
              Bình chọn ngay
              <span aria-hidden="true">→</span>
            </a>
            <button type="button" onClick={dismiss}>Để sau</button>
          </div>

          <p className="vote-popup-note">
            Cảm ơn bạn đã đồng hành và chia sẻ tới bạn bè, nhóm lớp, các CLB. <span aria-hidden="true">🌱</span>
          </p>
        </div>
      </section>
    </div>
  )
}
