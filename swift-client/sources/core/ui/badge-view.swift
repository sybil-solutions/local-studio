import SwiftUI

struct BadgeView: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.caption.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(color.opacity(0.15))
      .foregroundColor(color)
      .cornerRadius(8)
  }
}
