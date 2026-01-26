import Foundation

enum VoiceTranscriber {
  static func transcribe(fileUrl: URL, settings: SettingsStore) async throws -> String {
    guard let base = URL(string: settings.voiceUrl) else { throw VoiceError.invalidUrl }
    let url = base.appending(path: "/v1/audio/transcriptions")
    let boundary = "Boundary-\(UUID().uuidString)"
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

    var body = Data()
    body.append(field: "model", value: settings.voiceModel, boundary: boundary)
    body.append(fileUrl: fileUrl, name: "file", boundary: boundary)
    body.append("--\(boundary)--\r\n")
    request.httpBody = body

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw VoiceError.badResponse
    }
    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard let text = json?["text"] as? String else { throw VoiceError.badResponse }
    return text
  }
}

enum VoiceError: Error {
  case invalidUrl
  case badResponse
}

private extension Data {
  mutating func append(_ string: String) { append(string.data(using: .utf8) ?? Data()) }

  mutating func append(field name: String, value: String, boundary: String) {
    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
    append("\(value)\r\n")
  }

  mutating func append(fileUrl: URL, name: String, boundary: String) {
    let filename = fileUrl.lastPathComponent
    let data = (try? Data(contentsOf: fileUrl)) ?? Data()
    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
    append("Content-Type: audio/m4a\r\n\r\n")
    append(data)
    append("\r\n")
  }
}
