// CRITICAL
import SwiftUI

struct DrawerMenu: View {
  @Binding var isOpen: Bool
  @Binding var selection: DrawerRoute
  @State private var dragOffset: CGFloat = 0
  private let menuWidth: CGFloat = 260

  private var drawerOffset: CGFloat {
    let offset = dragOffset
    return max(-menuWidth, min(0, offset))
  }

  var body: some View {
    ZStack(alignment: .leading) {
      AppTheme.background.opacity(0.65)
        .ignoresSafeArea()
        .onTapGesture { withAnimation { isOpen = false } }
      DrawerMenuContent(isOpen: $isOpen, selection: $selection)
        .offset(x: drawerOffset)
        .gesture(
          DragGesture()
            .onChanged { value in
              dragOffset = value.translation.width
            }
            .onEnded { value in
              let closeThreshold: CGFloat = -100
              if value.translation.width < closeThreshold {
                withAnimation(.easeInOut(duration: 0.2)) { isOpen = false }
              }
              withAnimation(.easeInOut(duration: 0.2)) { dragOffset = 0 }
            }
        )
    }
  }
}

struct DrawerMenuContent: View {
  @Binding var isOpen: Bool
  @Binding var selection: DrawerRoute

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("vLLM Studio").font(AppTheme.sectionFont).padding(.top, 40)
      ForEach(DrawerRoute.allCases) { route in
        DrawerMenuItem(route: route, isSelected: selection == route) {
          selection = route
          withAnimation { isOpen = false }
        }
      }
      Spacer()
    }
    .padding(.horizontal, 16)
    .frame(width: 260, alignment: .topLeading)
    .frame(maxHeight: .infinity)
    .background(AppTheme.background)
  }
}
