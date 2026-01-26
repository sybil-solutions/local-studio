import SwiftUI

enum AppTheme {
  static let background = Color(hex: 0x1c1b19)
  static let foreground = Color(hex: 0xefece7)
  static let muted = Color(hex: 0x9a9590)
  static let border = Color(hex: 0x2a2725)
  static let card = Color(hex: 0x201f1d)
  static let accent = Color(hex: 0x382a46)
  static let accentStrong = Color(hex: 0x8c53c6)
  static let success = Color(hex: 0x3fa665)
  static let warning = Color(hex: 0xeea62b)
  static let error = Color(hex: 0xd14747)

  static let titleFont = Font.system(size: 20, weight: .semibold)
  static let sectionFont = Font.system(size: 16, weight: .semibold)
  static let bodyFont = Font.system(size: 14, weight: .regular)
  static let captionFont = Font.system(size: 12, weight: .regular)
  static let monoFont = Font.system(size: 12, weight: .regular, design: .monospaced)
}
