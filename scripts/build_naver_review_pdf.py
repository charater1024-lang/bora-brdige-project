from __future__ import annotations

from pathlib import Path
import os
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "BORA-Bridge-Naver-Login-Review.pdf"
SHOTS = ROOT / "output" / "review" / "screenshots"
ICON = ROOT / "output" / "review" / "favicon-128.png"
MASCOT = ROOT / "output" / "review" / "bora-mascot-128.png"

PAGE_W, PAGE_H = landscape(A4)
PURPLE = colors.HexColor("#6550C7")
DEEP = colors.HexColor("#211A3B")
MUTED = colors.HexColor("#625B73")
LINE = colors.HexColor("#DDD5F2")
PALE = colors.HexColor("#F6F3FF")
MINT = colors.HexColor("#EAF8F1")
RED = colors.HexColor("#B33A55")


def setup_fonts() -> None:
    regular = Path("C:/Windows/Fonts/malgun.ttf")
    bold = Path("C:/Windows/Fonts/malgunbd.ttf")
    if not regular.exists() or not bold.exists():
        raise FileNotFoundError("Malgun Gothic fonts are required to build the Korean review PDF.")
    pdfmetrics.registerFont(TTFont("Bora", str(regular)))
    pdfmetrics.registerFont(TTFont("BoraBold", str(bold)))
    pdfmetrics.registerFontFamily("Bora", normal="Bora", bold="BoraBold")


def paragraph(c: canvas.Canvas, text: str, x: float, y_top: float, width: float,
              size: float = 10.5, leading: float | None = None,
              color=DEEP, bold: bool = False, align: int = TA_LEFT) -> float:
    style = ParagraphStyle(
        "body",
        fontName="BoraBold" if bold else "Bora",
        fontSize=size,
        leading=leading or size * 1.55,
        textColor=color,
        alignment=align,
        wordWrap="CJK",
        spaceAfter=0,
    )
    flow = Paragraph(text, style)
    _, height = flow.wrap(width, PAGE_H)
    flow.drawOn(c, x, y_top - height)
    return height


def pill(c: canvas.Canvas, text: str, x: float, y: float, width: float,
         fill=PALE, ink=PURPLE) -> None:
    c.setFillColor(fill)
    c.roundRect(x, y, width, 24, 12, stroke=0, fill=1)
    c.setFillColor(ink)
    c.setFont("BoraBold", 8.5)
    c.drawCentredString(x + width / 2, y + 7.3, text)


def page_base(c: canvas.Canvas, number: int, section: str) -> None:
    c.setFillColor(colors.HexColor("#FBFAFF"))
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(PURPLE)
    c.roundRect(32, PAGE_H - 47, 26, 26, 8, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("BoraBold", 12)
    c.drawCentredString(45, PAGE_H - 38.5, "B")
    c.setFillColor(DEEP)
    c.setFont("BoraBold", 10)
    c.drawString(67, PAGE_H - 39, "BORA Bridge")
    c.setFillColor(MUTED)
    c.setFont("Bora", 8)
    c.drawRightString(PAGE_W - 32, PAGE_H - 39, f"NAVER LOGIN REVIEW · {section}")
    c.setStrokeColor(LINE)
    c.line(32, PAGE_H - 56, PAGE_W - 32, PAGE_H - 56)
    c.setFillColor(MUTED)
    c.setFont("Bora", 7.5)
    c.drawString(32, 20, "개인 개발 프로젝트 · 운영 도메인 https://borabridge.com")
    c.drawRightString(PAGE_W - 32, 20, f"{number} / 8")


def title(c: canvas.Canvas, eyebrow: str, heading: str, lead: str, y: float = PAGE_H - 90) -> float:
    c.setFillColor(PURPLE)
    c.setFont("BoraBold", 8.5)
    c.drawString(44, y, eyebrow)
    c.setFillColor(DEEP)
    c.setFont("BoraBold", 25)
    c.drawString(44, y - 34, heading)
    paragraph(c, lead, 44, y - 49, PAGE_W - 88, 10.5, 16, MUTED)
    return y - 90


def bullet_list(c: canvas.Canvas, items: list[str], x: float, y_top: float,
                width: float, size: float = 10) -> float:
    y = y_top
    for item in items:
        c.setFillColor(PURPLE)
        c.circle(x + 4, y - 8, 2.2, stroke=0, fill=1)
        h = paragraph(c, item, x + 15, y, width - 15, size, size * 1.55, DEEP)
        y -= h + 8
    return y


def screenshot_box(c: canvas.Canvas, path: Path, x: float, y: float,
                   width: float, height: float,
                   redactions: list[tuple[float, float, float, float]] | None = None) -> None:
    image = ImageReader(str(path))
    image_w, image_h = image.getSize()
    scale = min(width / image_w, height / image_h)
    draw_w, draw_h = image_w * scale, image_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, width, height, 12, stroke=1, fill=1)
    c.drawImage(image, draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True, mask="auto")
    if redactions:
        for rx, ry, rw, rh in redactions:
            px = draw_x + rx * scale
            py = draw_y + (image_h - ry - rh) * scale
            c.setFillColor(colors.HexColor("#E7E1F7"))
            c.roundRect(px, py, rw * scale, rh * scale, 3, stroke=0, fill=1)
            if rw * scale > 65:
                c.setFillColor(PURPLE)
                c.setFont("BoraBold", 5.5)
                c.drawCentredString(px + rw * scale / 2, py + rh * scale / 2 - 2, "개인정보 마스킹")


def link_text(c: canvas.Canvas, label: str, url: str, x: float, y: float, width: float) -> None:
    c.setFillColor(PURPLE)
    c.setFont("BoraBold", 9)
    c.drawString(x, y, label)
    c.setFillColor(MUTED)
    c.setFont("Bora", 8.5)
    c.drawString(x, y - 15, url)
    c.linkURL(url, (x, y - 18, x + width, y + 8), relative=0)


def build() -> None:
    setup_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("BORA Bridge 네이버 로그인 사전 검수 자료")
    c.setAuthor("BORA Bridge 개인 개발 프로젝트")

    # 1. Cover
    page_base(c, 1, "OVERVIEW")
    c.drawImage(str(ICON), 50, PAGE_H - 214, 98, 98, mask="auto")
    c.drawImage(str(MASCOT), PAGE_W - 195, 54, 140, 140, mask="auto")
    c.setFillColor(PURPLE)
    c.setFont("BoraBold", 10)
    c.drawString(175, PAGE_H - 124, "NAVER LOGIN · PRE-REVIEW DOSSIER")
    c.setFillColor(DEEP)
    c.setFont("BoraBold", 32)
    c.drawString(175, PAGE_H - 169, "BORA Bridge")
    c.setFont("BoraBold", 23)
    c.drawString(175, PAGE_H - 204, "네이버 로그인 사전 검수 자료")
    paragraph(c, "청년·고령층·장애인·외국인이 금융 정보를 이해하고, 위험을 확인하며, 정책과 창업 기회를 찾도록 돕는 포용금융 웹 서비스입니다.", 175, PAGE_H - 228, 530, 12, 19, MUTED)
    pill(c, "운영 HTTPS", 175, 224, 92)
    pill(c, "PC · 모바일 웹", 277, 224, 112)
    pill(c, "개인 개발", 399, 224, 86)
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(50, 74, 570, 118, 18, stroke=1, fill=1)
    paragraph(c, "<b>서비스 URL</b><br/>https://borabridge.com", 70, 172, 245, 10.5, 18)
    paragraph(c, "<b>네이버 Callback URL</b><br/>https://borabridge.com/api/auth/callback/naver", 325, 172, 275, 10.5, 18)
    paragraph(c, "검수 목적: 불특정 일반 사용자가 네이버 계정으로 로그인하고, 본인이 허용한 프로필을 마이페이지와 표시 이름 설정에 사용하는 전체 흐름 확인", 70, 118, 520, 9.5, 15, MUTED)
    c.showPage()

    # 2. Service and login choices
    page_base(c, 2, "SERVICE & LOGIN")
    body_top = title(c, "01 · SERVICE ENTRY", "로그인 진입과 서비스 목적", "홈과 왼쪽 아래 BORA Member에서 동일한 로그인 선택창을 열 수 있습니다.")
    screenshot_box(c, SHOTS / "01-login-options.png", 370, 75, 430, 365)
    c.setFillColor(colors.white)
    c.roundRect(44, 75, 300, 365, 16, stroke=1, fill=1)
    c.setStrokeColor(LINE)
    paragraph(c, "<b>서비스가 해결하는 문제</b>", 64, body_top + 3, 255, 13, 19)
    bullet_list(c, [
        "공식 공공데이터와 직접 입력값만 사용해 자산·정책·안심 행동을 안내합니다.",
        "네이버 로그인은 계정 장부와 맞춤 설정을 같은 계정으로 다시 불러오기 위해 사용합니다.",
        "네이버 비밀번호·계좌번호·카드번호는 요청하거나 저장하지 않습니다.",
        "카카오와 네이버만 사용자 화면에 제공하며 Google 로그인은 향후 지원으로 분리했습니다.",
    ], 64, body_top - 30, 255, 9.7)
    c.showPage()

    # 3. OAuth flow
    page_base(c, 3, "LOGIN FLOW")
    title(c, "02 · END-TO-END FLOW", "로그인 전 과정", "별도 BORA 비밀번호 없이 네이버 OAuth와 일회성 state·PKCE를 사용합니다.")
    steps = [
        ("1", "로그인 선택", "홈 또는 BORA Member에서 네이버 선택"),
        ("2", "네이버 인증", "네이버 화면에서 계정 인증과 제공정보 동의"),
        ("3", "운영 콜백", "borabridge.com의 정확한 callback으로 복귀"),
        ("4", "필수 약관", "최초 또는 약관 버전 변경 시 동의 화면 표시"),
        ("5", "마이페이지", "로그인 정보·표시 이름·저장 항목·삭제 기능 제공"),
    ]
    x = 44
    for index, (num, heading, body) in enumerate(steps):
        card_w = 140
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x, 280, card_w, 142, 16, stroke=1, fill=1)
        c.setFillColor(PURPLE)
        c.circle(x + 24, 394, 14, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("BoraBold", 10)
        c.drawCentredString(x + 24, 390.5, num)
        paragraph(c, f"<b>{heading}</b>", x + 18, 365, card_w - 36, 11, 16)
        paragraph(c, body, x + 18, 334, card_w - 36, 8.5, 13, MUTED)
        if index < len(steps) - 1:
            c.setStrokeColor(PURPLE)
            c.line(x + card_w + 4, 351, x + card_w + 14, 351)
        x += 154
    c.setFillColor(PALE)
    c.roundRect(44, 98, PAGE_W - 88, 132, 18, stroke=0, fill=1)
    paragraph(c, "<b>보안 경계</b>", 64, 208, 220, 12, 18)
    bullet_list(c, [
        "OAuth 요청마다 state와 PKCE code challenge를 생성하고, 시작 거래는 약 10분 뒤 만료됩니다.",
        "제공사 access token은 프로필 조회 후 저장하지 않으며, 서버에는 세션 토큰 원문 대신 해시만 보관합니다.",
        "운영 개발자 콘솔에는 HTTPS 대표 도메인 callback 하나만 등록합니다.",
    ], 64, 177, PAGE_W - 128, 9.5)
    c.showPage()

    # 4. Profile use with redaction
    page_base(c, 4, "PROFILE USE")
    title(c, "03 · PROFILE FIELDS", "제공정보의 실제 활용 화면", "프로필 값은 로그인 정보 확인과 표시 이름 선택에만 사용하며, 법적 본인확인이나 금융 자격 판정에 사용하지 않습니다.")
    screenshot_box(
        c,
        SHOTS / "04-mypage-profile-raw.png",
        44,
        140,
        PAGE_W - 88,
        305,
        redactions=[
            (450, 115, 175, 55),
            (500, 345, 245, 28),
            (500, 399, 135, 24),
            (500, 445, 110, 24),
            (1428, 266, 100, 25),
            (964, 372, 120, 27),
            (964, 438, 120, 27),
            (936, 616, 130, 32),
        ],
    )
    c.setFillColor(MINT)
    c.roundRect(44, 67, PAGE_W - 88, 56, 14, stroke=0, fill=1)
    paragraph(c, "<b>요청 항목</b> · 회원이름: 필수(인사말·표시 이름 선택) · 이메일: 계정 정보 확인 · 별명: 선택(표시 이름 선택) · 성별/생일/연령대/출생연도: 요청하지 않음", 62, 108, PAGE_W - 124, 9.5, 15, DEEP)
    c.showPage()

    # 5. Consent and deletion
    page_base(c, 5, "CONSENT & DELETION")
    title(c, "04 · USER CONTROL", "필수 동의·저장 항목·삭제", "최초 로그인 뒤 최신 이용약관과 개인정보 처리방침에 동의해야 개인화 기능을 사용할 수 있습니다.")
    screenshot_box(c, SHOTS / "05-onboarding-consent.png", 44, 128, PAGE_W - 88, 300)
    bullet_list(c, [
        "마이페이지에서 계정별 저장 항목 수를 확인할 수 있습니다.",
        "AI 기억·최근 대화·최근 활동은 각각 기본 OFF이며 별도로 켜고 삭제합니다.",
        "직접 입력 장부·맞춤 프로필·계정 전체 삭제를 사용자 스스로 요청할 수 있습니다.",
    ], 55, 112, PAGE_W - 110, 8.8)
    c.showPage()

    # 6. Privacy page
    page_base(c, 6, "PRIVACY")
    title(c, "05 · PUBLIC POLICY", "비로그인 공개 개인정보 처리방침", "검수자는 로그인하지 않고도 처리 항목·목적·보유·삭제·문의처를 확인할 수 있습니다.")
    screenshot_box(c, SHOTS / "02-privacy-public.png", 44, 90, 455, 350)
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(520, 90, 278, 350, 16, stroke=1, fill=1)
    paragraph(c, "<b>핵심 공개 내용</b>", 542, 412, 235, 13, 19)
    bullet_list(c, [
        "네이버·카카오 OAuth와 서버 세션 처리",
        "직접 입력한 자산·부채·현금흐름 합계만 저장",
        "마이데이터·오픈뱅킹·카드 거래내역 자동 연결 없음",
        "선택형 AI 맥락의 기본 OFF 및 로컬 AI 전용 범위",
        "열람·정정·개별 삭제·계정 전체 삭제 방법",
        "한국어·영어·일본어·중국어 제공",
    ], 542, 378, 235, 9)
    link_text(c, "공개 URL", "https://borabridge.com/privacy", 542, 125, 230)
    c.showPage()

    # 7. Terms page
    page_base(c, 7, "TERMS")
    title(c, "06 · SERVICE BOUNDARY", "비로그인 공개 이용약관", "금융정보·AI 설명의 한계와 공식 원문 재확인 원칙을 명확하게 고지합니다.")
    screenshot_box(c, SHOTS / "03-terms-public.png", 44, 90, 455, 350)
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(520, 90, 278, 350, 16, stroke=1, fill=1)
    paragraph(c, "<b>이용자에게 먼저 알리는 범위</b>", 542, 412, 235, 13, 19)
    bullet_list(c, [
        "계산·요약·추천은 참고 정보이며 계약·투자 지시가 아님",
        "금융상품 가입과 정책 신청 전 최신 공식 원문 재확인",
        "사용자 직접 입력값은 은행 검증값으로 표현하지 않음",
        "피싱 분석은 위험 신호와 행동 요령이며 안전 보장이 아님",
        "민감정보 입력 금지와 계정 이용자 책임",
    ], 542, 378, 235, 9.2)
    link_text(c, "공개 URL", "https://borabridge.com/terms", 542, 125, 230)
    c.showPage()

    # 8. Submission sheet
    page_base(c, 8, "SUBMISSION SHEET")
    title(c, "07 · REVIEW CHECKLIST", "검수 제출 정보 요약", "검수 담당자가 로그인 경로와 제공정보 활용을 빠르게 재현할 수 있도록 정리했습니다.")
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(44, 100, 355, 340, 18, stroke=1, fill=1)
    paragraph(c, "<b>네이버 개발자 콘솔 등록값</b>", 66, 410, 310, 13, 19)
    bullet_list(c, [
        "애플리케이션: BORA Bridge",
        "환경: PC 웹 · Mobile 웹",
        "서비스 URL: https://borabridge.com",
        "Callback: https://borabridge.com/api/auth/callback/naver",
        "회원이름: 필수 · 이메일: 마이페이지 계정 확인 · 별명: 선택",
        "성별·생일·연령대·출생연도·휴대전화번호: 미요청",
    ], 66, 372, 310, 9.2)
    c.setFillColor(PALE)
    c.roundRect(420, 100, 378, 340, 18, stroke=0, fill=1)
    paragraph(c, "<b>검수 재현 순서</b>", 445, 410, 330, 13, 19)
    bullet_list(c, [
        "1. https://borabridge.com 접속",
        "2. BORA Member 또는 상단 로그인 버튼 선택",
        "3. 네이버로 계속하기 선택 후 네이버 동의 화면 확인",
        "4. 운영 callback 복귀 후 최초 필수 동의 확인",
        "5. 마이페이지에서 로그인 정보와 표시 이름 선택 확인",
        "6. 저장 항목·개인정보 처리방침·이용약관·삭제 기능 확인",
    ], 445, 372, 330, 9.4)
    c.setFillColor(MINT)
    c.roundRect(445, 132, 328, 68, 14, stroke=0, fill=1)
    contact = os.environ.get("LEGAL_CONTACT_EMAIL", "").strip()
    paragraph(c, "문의 · BORA Bridge 개인 개발 프로젝트<br/>" + escape(contact or "운영자 문의 이메일 설정 필요"), 462, 181, 295, 9.5, 16, DEEP)
    c.save()


if __name__ == "__main__":
    build()
    print(OUT)
