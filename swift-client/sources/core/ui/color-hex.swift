import SwiftUI

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    let r = Double((hex >> 16) & 0xff) / 255
    let g = Double((hex >> 8) & 0xff) / 255
    let b = Double(hex & 0xff) / 255
    self = Color(.sRGB, red: r, green: g, blue: b, opacity: alpha)
  }
}
