import SwiftUI

struct ChatDetailView: View {
  let sessionId: String
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ChatDetailViewModel()

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 12) {
            ForEach(model.messages) { message in
              ChatMessageRow(message: message).id(message.id)
            }
          }
          .padding(16)
        }
        .onChange(of: model.messages.count) { _ in
          if let last = model.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
      ChatInputBar(text: $model.input) { Task { await model.sendMessage() } }
    }
    .navigationTitle(model.title.isEmpty ? "Chat" : model.title)
    .onAppear { model.connect(api: container.api, settings: container.settings, sessionId: sessionId) }
  }
}
