import SwiftUI

struct CardView<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }

  var body: some View {
    content
      .padding(12)
      .background(AppTheme.card)
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.border))
      .cornerRadius(14)
  }
}
