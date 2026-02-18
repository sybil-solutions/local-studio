// CRITICAL
import SwiftUI

struct ThemeColors {
    let background: Color
    let card: Color
    let cardHover: Color
    let muted: Color
    let foreground: Color
    let border: Color
    let accent: Color
    let accentStrong: Color
    let chromeSidebar: Color
    let chromePanel: Color
    let chromeBorder: Color
    let chromeBorderStrong: Color
    let link: Color
    let error: Color
    let success: Color
    let warning: Color
}

struct ThemeFonts {
    let titleFont: Font
    let sectionFont: Font
    let bodyFont: Font
    let captionFont: Font
    let monoFont: Font

    static let `default` = ThemeFonts(
        titleFont: .system(size: 24, weight: .semibold, design: .default),
        sectionFont: .system(size: 20, weight: .semibold, design: .default),
        bodyFont: .system(size: 17, weight: .regular, design: .default),
        captionFont: .system(size: 12, weight: .regular, design: .default),
        monoFont: .system(size: 17, weight: .regular, design: .monospaced)
    )
}

struct AppTheme: Identifiable {
    let id: String
    let name: String
    let colors: ThemeColors
    let fonts: ThemeFonts
}

private func appColor(_ hex: UInt32, alpha: Double = 1.0) -> Color {
    let red = Double((hex >> 16) & 0xff) / 255
    let green = Double((hex >> 8) & 0xff) / 255
    let blue = Double(hex & 0xff) / 255
    return Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
}

extension AppTheme {
    private static func make(
        id: String,
        name: String,
        background: UInt32,
        card: UInt32,
        cardHover: UInt32,
        muted: UInt32,
        foreground: UInt32,
        border: UInt32,
        accent: UInt32,
        accentStrong: UInt32,
        chromeSidebar: UInt32,
        chromePanel: UInt32,
        chromeBorder: UInt32,
        chromeBorderStrong: UInt32,
        link: UInt32,
        error: UInt32,
        success: UInt32,
        warning: UInt32
    ) -> AppTheme {
        AppTheme(
            id: id,
            name: name,
            colors: ThemeColors(
                background: appColor(background),
                card: appColor(card),
                cardHover: appColor(cardHover),
                muted: appColor(muted),
                foreground: appColor(foreground),
                border: appColor(border),
                accent: appColor(accent),
                accentStrong: appColor(accentStrong),
                chromeSidebar: appColor(chromeSidebar),
                chromePanel: appColor(chromePanel),
                chromeBorder: appColor(chromeBorder),
                chromeBorderStrong: appColor(chromeBorderStrong),
                link: appColor(link),
                error: appColor(error),
                success: appColor(success),
                warning: appColor(warning)
            ),
            fonts: ThemeFonts.default
        )
    }

    static let all: [AppTheme] = [
        make(
            id: "midnight-void",
            name: "Midnight Void",
            background: 0x0f1117,
            card: 0x181a20,
            cardHover: 0x1e2029,
            muted: 0x8d93a6,
            foreground: 0xe8eaf1,
            border: 0x2e3342,
            accent: 0x7c87ff,
            accentStrong: 0xa4adff,
            chromeSidebar: 0x14161d,
            chromePanel: 0x11141a,
            chromeBorder: 0x2a2f3a,
            chromeBorderStrong: 0x434b5a,
            link: 0x8ab4ff,
            error: 0xff6b6b,
            success: 0x6ee7b7,
            warning: 0xf4cf58
        ),
        make(
            id: "dracula",
            name: "Dracula",
            background: 0x282a36,
            card: 0x44475a,
            cardHover: 0x4f5268,
            muted: 0x6272a4,
            foreground: 0xf8f8f2,
            border: 0x6c7086,
            accent: 0xff79c6,
            accentStrong: 0xff92df,
            chromeSidebar: 0x1b1f2d,
            chromePanel: 0x21222c,
            chromeBorder: 0x44475a,
            chromeBorderStrong: 0x6272a4,
            link: 0xbd93f9,
            error: 0xff5555,
            success: 0x50fa7b,
            warning: 0xffb86c
        ),
        make(
            id: "monokai",
            name: "Monokai",
            background: 0x272822,
            card: 0x3e3d32,
            cardHover: 0x49483e,
            muted: 0x75715e,
            foreground: 0xf8f8f2,
            border: 0x49483e,
            accent: 0xa6e22e,
            accentStrong: 0xd7e02b,
            chromeSidebar: 0x1e201c,
            chromePanel: 0x262822,
            chromeBorder: 0x49483e,
            chromeBorderStrong: 0xa6e22e,
            link: 0x66d9ef,
            error: 0xf92672,
            success: 0xa6e22e,
            warning: 0xfd971f
        ),
        make(
            id: "nord",
            name: "Nord",
            background: 0x2e3440,
            card: 0x3b4252,
            cardHover: 0x434c5e,
            muted: 0x8f9cb4,
            foreground: 0xe5e9f0,
            border: 0x4c566a,
            accent: 0x88c0d0,
            accentStrong: 0x8fbcbb,
            chromeSidebar: 0x242a36,
            chromePanel: 0x323a49,
            chromeBorder: 0x4c566a,
            chromeBorderStrong: 0x88c0d0,
            link: 0x81a1c1,
            error: 0xbf616a,
            success: 0xa3be8c,
            warning: 0xebcb8b
        ),
        make(
            id: "solarized-dark",
            name: "Solarized Dark",
            background: 0x002b36,
            card: 0x073642,
            cardHover: 0x0b4f59,
            muted: 0x839496,
            foreground: 0x93a1a1,
            border: 0x586e75,
            accent: 0x268bd2,
            accentStrong: 0x2aa198,
            chromeSidebar: 0x071e26,
            chromePanel: 0x03242e,
            chromeBorder: 0x586e75,
            chromeBorderStrong: 0x2aa198,
            link: 0x268bd2,
            error: 0xdc322f,
            success: 0x859900,
            warning: 0xb58900
        ),
        make(
            id: "catppuccin-mocha",
            name: "Catppuccin Mocha",
            background: 0x1e1e2e,
            card: 0x313244,
            cardHover: 0x45475a,
            muted: 0x6c7086,
            foreground: 0xcdd6f4,
            border: 0x45475a,
            accent: 0x89b4fa,
            accentStrong: 0xb4befe,
            chromeSidebar: 0x181825,
            chromePanel: 0x313244,
            chromeBorder: 0x45475a,
            chromeBorderStrong: 0xcba6f7,
            link: 0x89b4fa,
            error: 0xf38ba8,
            success: 0xa6e3a1,
            warning: 0xf9e2af
        ),
        make(
            id: "tokyo-night",
            name: "Tokyo Night",
            background: 0x1a1b26,
            card: 0x24283b,
            cardHover: 0x2f334f,
            muted: 0x9aa5ce,
            foreground: 0xa9b1d6,
            border: 0x3b4261,
            accent: 0x7aa2f7,
            accentStrong: 0xbb9af7,
            chromeSidebar: 0x16161e,
            chromePanel: 0x1f2335,
            chromeBorder: 0x3b4261,
            chromeBorderStrong: 0x7aa2f7,
            link: 0x7aa2f7,
            error: 0xf7768e,
            success: 0x9ece6a,
            warning: 0xe0af68
        ),
        make(
            id: "gruvbox-dark",
            name: "Gruvbox Dark",
            background: 0x282828,
            card: 0x3c3836,
            cardHover: 0x504945,
            muted: 0xa89984,
            foreground: 0xebdbb2,
            border: 0x665c54,
            accent: 0xd3869b,
            accentStrong: 0xb8bb26,
            chromeSidebar: 0x1d2021,
            chromePanel: 0x32302f,
            chromeBorder: 0x665c54,
            chromeBorderStrong: 0xd79921,
            link: 0x8ec07c,
            error: 0xfb4934,
            success: 0xb8bb26,
            warning: 0xfabd2f
        ),
        make(
            id: "ayu-mirage",
            name: "Ayu Mirage",
            background: 0x171b24,
            card: 0x252b3b,
            cardHover: 0x313a4a,
            muted: 0x707a8c,
            foreground: 0xe6e1cf,
            border: 0x3c465f,
            accent: 0xffcc66,
            accentStrong: 0xffa759,
            chromeSidebar: 0x10151f,
            chromePanel: 0x1f2433,
            chromeBorder: 0x3c465f,
            chromeBorderStrong: 0xffcc66,
            link: 0x5ccfe6,
            error: 0xff6666,
            success: 0x7afc8f,
            warning: 0xffb454
        ),
        make(
            id: "github-dark",
            name: "GitHub Dark",
            background: 0x0d1117,
            card: 0x161b22,
            cardHover: 0x21262d,
            muted: 0x8b949e,
            foreground: 0xc9d1d9,
            border: 0x30363d,
            accent: 0x58a6ff,
            accentStrong: 0x79c0ff,
            chromeSidebar: 0x010409,
            chromePanel: 0x0d1117,
            chromeBorder: 0x30363d,
            chromeBorderStrong: 0x58a6ff,
            link: 0x58a6ff,
            error: 0xf85149,
            success: 0x3fb950,
            warning: 0xd29922
        ),
        make(
            id: "material-ocean",
            name: "Material Ocean",
            background: 0x1b2228,
            card: 0x263238,
            cardHover: 0x2f3b43,
            muted: 0x8c9bab,
            foreground: 0xcfd8dc,
            border: 0x455a64,
            accent: 0x82aaff,
            accentStrong: 0x89ddff,
            chromeSidebar: 0x11171b,
            chromePanel: 0x1f2a30,
            chromeBorder: 0x455a64,
            chromeBorderStrong: 0xffcb6b,
            link: 0x82aaff,
            error: 0xff5370,
            success: 0xc3e88d,
            warning: 0xffcb6b
        ),
        make(
            id: "cobalt2",
            name: "Cobalt2",
            background: 0x102f43,
            card: 0x164965,
            cardHover: 0x1e5f8d,
            muted: 0x8eaec5,
            foreground: 0xcdd9e5,
            border: 0x2f77a4,
            accent: 0xef6b73,
            accentStrong: 0xffc66b,
            chromeSidebar: 0x0f2438,
            chromePanel: 0x113f5f,
            chromeBorder: 0x2f77a4,
            chromeBorderStrong: 0xef6b73,
            link: 0x82aaff,
            error: 0xff5370,
            success: 0x9ed067,
            warning: 0xffcb6b
        ),
        make(
            id: "night-owl",
            name: "Night Owl",
            background: 0x011627,
            card: 0x011f30,
            cardHover: 0x0e293f,
            muted: 0x637777,
            foreground: 0xd6deeb,
            border: 0x223b50,
            accent: 0x82aaff,
            accentStrong: 0x5f7eff,
            chromeSidebar: 0x011017,
            chromePanel: 0x011f30,
            chromeBorder: 0x223b50,
            chromeBorderStrong: 0x82aaff,
            link: 0x82aaff,
            error: 0xff5874,
            success: 0xaddb67,
            warning: 0xffcb6b
        ),
        make(
            id: "palenight",
            name: "Palenight",
            background: 0x292d3e,
            card: 0x32374d,
            cardHover: 0x43485f,
            muted: 0x959dcb,
            foreground: 0xf5f7ff,
            border: 0x464b63,
            accent: 0x82aaff,
            accentStrong: 0xc792ea,
            chromeSidebar: 0x1f2337,
            chromePanel: 0x2a2f45,
            chromeBorder: 0x464b63,
            chromeBorderStrong: 0x82aaff,
            link: 0x82aaff,
            error: 0xf07178,
            success: 0xc3e88d,
            warning: 0xffcb6b
        ),
        make(
            id: "horizon",
            name: "Horizon",
            background: 0x1c1e26,
            card: 0x2f313f,
            cardHover: 0x3b3d52,
            muted: 0x7c7f93,
            foreground: 0xe2e4f3,
            border: 0x464a61,
            accent: 0xe95678,
            accentStrong: 0xffbf00,
            chromeSidebar: 0x161821,
            chromePanel: 0x232634,
            chromeBorder: 0x464a61,
            chromeBorderStrong: 0x6ab0f3,
            link: 0x6ab0f3,
            error: 0xf43e5c,
            success: 0x29d398,
            warning: 0xff9e64
        ),
        make(
            id: "obsidian",
            name: "Obsidian",
            background: 0x141414,
            card: 0x1f1f1f,
            cardHover: 0x2a2a2a,
            muted: 0x8f8f8f,
            foreground: 0xe6e6e6,
            border: 0x3d3d3d,
            accent: 0x6ba4ff,
            accentStrong: 0x8bc0ff,
            chromeSidebar: 0x0f0f0f,
            chromePanel: 0x191919,
            chromeBorder: 0x3d3d3d,
            chromeBorderStrong: 0x6ba4ff,
            link: 0x6ba4ff,
            error: 0xff5f56,
            success: 0x57d9a3,
            warning: 0xf7b955
        ),
        make(
            id: "deep-ocean",
            name: "Deep Ocean",
            background: 0x001119,
            card: 0x0b2239,
            cardHover: 0x17354d,
            muted: 0x6e8ea4,
            foreground: 0xcde5ff,
            border: 0x12405e,
            accent: 0x20b2aa,
            accentStrong: 0x64d5db,
            chromeSidebar: 0x001a24,
            chromePanel: 0x02253a,
            chromeBorder: 0x12405e,
            chromeBorderStrong: 0x20b2aa,
            link: 0x6ce5e8,
            error: 0xff4b4b,
            success: 0x57e389,
            warning: 0xf8d477
        ),
        make(
            id: "forest-night",
            name: "Forest Night",
            background: 0x131f11,
            card: 0x1a2b17,
            cardHover: 0x2a3d26,
            muted: 0x8ca17d,
            foreground: 0xd2ddc8,
            border: 0x3b4f2d,
            accent: 0x98c379,
            accentStrong: 0xbddc96,
            chromeSidebar: 0x0f190f,
            chromePanel: 0x1c2f17,
            chromeBorder: 0x3b4f2d,
            chromeBorderStrong: 0x98c379,
            link: 0x98c379,
            error: 0xff7f70,
            success: 0x98c379,
            warning: 0xf0d67a
        ),
        make(
            id: "synthwave",
            name: "Synthwave",
            background: 0x14101e,
            card: 0x201a2f,
            cardHover: 0x2f2742,
            muted: 0x8f88a4,
            foreground: 0xf5eefc,
            border: 0x403657,
            accent: 0xff6ad5,
            accentStrong: 0xff9a5c,
            chromeSidebar: 0x0f0a17,
            chromePanel: 0x1c1429,
            chromeBorder: 0x403657,
            chromeBorderStrong: 0xff6ad5,
            link: 0xbb7bf7,
            error: 0xff5f56,
            success: 0x00ffa1,
            warning: 0xffd166
        )
    ]

    static var `default`: AppTheme {
        all.first { $0.id == "midnight-void" } ?? all[0]
    }

    static var current: AppTheme = AppTheme.default

    static var background: Color { current.colors.background }
    static var card: Color { current.colors.card }
    static var cardHover: Color { current.colors.cardHover }
    static var muted: Color { current.colors.muted }
    static var foreground: Color { current.colors.foreground }
    static var border: Color { current.colors.border }
    static var accent: Color { current.colors.accent }
    static var accentStrong: Color { current.colors.accentStrong }
    static var chromeSidebar: Color { current.colors.chromeSidebar }
    static var chromePanel: Color { current.colors.chromePanel }
    static var chromeBorder: Color { current.colors.chromeBorder }
    static var chromeBorderStrong: Color { current.colors.chromeBorderStrong }
    static var link: Color { current.colors.link }
    static var error: Color { current.colors.error }
    static var success: Color { current.colors.success }
    static var warning: Color { current.colors.warning }

    static var sectionFont: Font { current.fonts.sectionFont }
    static var bodyFont: Font { current.fonts.bodyFont }
    static var captionFont: Font { current.fonts.captionFont }
    static var monoFont: Font { current.fonts.monoFont }
    static var titleFont: Font { current.fonts.titleFont }
}
