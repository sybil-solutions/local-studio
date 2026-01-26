import Foundation

struct ProcessInfo: Codable {
  let pid: Int
  let backend: String
  let modelPath: String?
  let port: Int
  let servedModelName: String?
}
