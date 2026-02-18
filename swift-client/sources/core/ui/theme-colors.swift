// CRITICAL
import SwiftUI

/// View modifier to apply theme colors to any view
struct ThemeColorsModifier: ViewModifier {
    let colors: ThemeColors
    
    func body(content: Content) -> some View {
        content
            .background(colors.background.ignoresSafeArea())
            .foregroundColor(colors.foreground)
    }
}

/// Extension to apply theme colors directly
extension View {
    func themeColors(_ colors: ThemeColors) -> some View {
        self.modifier(ThemeColorsModifier(colors: colors))
    }
}

/// View modifier to apply theme fonts to any view
struct ThemeFontsModifier: ViewModifier {
    let fonts: ThemeFonts
    
    func body(content: Content) -> some View {
        content
            .font(fonts.bodyFont)
    }
}

/// Extension to apply theme fonts directly
extension View {
    func themeFonts(_ fonts: ThemeFonts) -> some View {
        self.modifier(ThemeFontsModifier(fonts: fonts))
    }
}

/// Extension to apply a complete theme to any view
extension View {
    func theme(_ theme: AppTheme) -> some View {
        self
            .themeColors(theme.colors)
            .themeFonts(theme.fonts)
    }
}

/// Extension to apply accent color tint
extension View {
    func accentTint(_ theme: AppTheme) -> some View {
        self.tint(theme.colors.accentStrong)
    }
}
