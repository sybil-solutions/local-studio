import Foundation

enum ArtifactType: String, CaseIterable {
  case html
  case svg
  case react
  case markdown

  var label: String {
    switch self {
    case .html: return "HTML"
    case .svg: return "SVG"
    case .react: return "React"
    case .markdown: return "Markdown"
    }
  }

  var icon: String {
    switch self {
    case .html: return "doc.richtext"
    case .svg: return "paintpalette"
    case .react: return "atom"
    case .markdown: return "doc.text"
    }
  }
}

struct Artifact: Identifiable {
  let id: String
  let type: ArtifactType
  let title: String
  let code: String
}

struct ArtifactParseResult {
  let text: String
  let artifacts: [Artifact]
}
