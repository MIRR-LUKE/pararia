import Foundation

enum TeacherPlatform: String, Codable {
    case ios = "IOS"
}

struct TeacherClientInfo: Codable {
    let platform: String
    let appVersion: String?
    let buildNumber: String?

    static let current = TeacherClientInfo(
        platform: TeacherPlatform.ios.rawValue,
        appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
        buildNumber: Bundle.main.infoDictionary?["CFBundleVersion"] as? String
    )
}

struct TeacherSession: Codable {
    let userId: String
    let organizationId: String
    let deviceId: String
    let role: String
    let roleLabel: String
    let userName: String?
    let userEmail: String?
    let deviceLabel: String
    let issuedAt: String
    let expiresAt: String
}

struct TeacherAuthBundle: Codable {
    let accessToken: String
    let accessTokenExpiresAt: String
    let refreshToken: String
    let refreshTokenExpiresAt: String
    let authSessionId: String
    let tokenType: String
}

struct TeacherNativeAuthResponse: Codable {
    let session: TeacherSession
    let client: TeacherClientInfo
    let auth: TeacherAuthBundle
}

struct TeacherSessionEnvelope: Codable {
    let session: TeacherSession
}

struct TeacherLogoutResponse: Codable {
    let ok: Bool
}

struct TeacherRecordingEnvelope: Codable {
    let recording: TeacherRecordingSummary?
}

struct TeacherCreateRecordingResponse: Codable {
    let recordingId: String
}

struct TeacherConfirmRecordingResponse: Codable {
    let ok: Bool
}

enum TeacherRecordingStatus: String, Codable {
    case recording = "RECORDING"
    case transcribing = "TRANSCRIBING"
    case awaitingStudentConfirmation = "AWAITING_STUDENT_CONFIRMATION"
    case studentConfirmed = "STUDENT_CONFIRMED"
    case cancelled = "CANCELLED"
    case error = "ERROR"
}

struct TeacherStudentCandidate: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let subtitle: String?
    let score: Double?
    let reason: String?
}

struct TeacherRecordingSummary: Codable, Identifiable {
    let id: String
    let status: TeacherRecordingStatus
    let deviceLabel: String
    let recordedAt: String?
    let uploadedAt: String?
    let analyzedAt: String?
    let confirmedAt: String?
    let durationSeconds: Double?
    let transcriptText: String?
    let candidates: [TeacherStudentCandidate]
    let errorMessage: String?
}

struct PendingUpload: Codable, Identifiable, Hashable {
    let id: String
    let recordingId: String
    let fileURL: URL
    let createdAt: Date
    let durationSeconds: Double?
    let attemptCount: Int
    let lastAttemptAt: Date?
    var errorMessage: String?

    init(
        id: String,
        recordingId: String,
        fileURL: URL,
        createdAt: Date,
        durationSeconds: Double? = nil,
        attemptCount: Int = 0,
        lastAttemptAt: Date? = nil,
        errorMessage: String? = nil
    ) {
        self.id = id
        self.recordingId = recordingId
        self.fileURL = fileURL
        self.createdAt = createdAt
        self.durationSeconds = durationSeconds
        self.attemptCount = attemptCount
        self.lastAttemptAt = lastAttemptAt
        self.errorMessage = errorMessage
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case recordingId
        case fileURL
        case createdAt
        case durationSeconds
        case attemptCount
        case lastAttemptAt
        case errorMessage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        recordingId = try container.decode(String.self, forKey: .recordingId)
        fileURL = try container.decode(URL.self, forKey: .fileURL)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        durationSeconds = try container.decodeIfPresent(Double.self, forKey: .durationSeconds)
        attemptCount = try container.decodeIfPresent(Int.self, forKey: .attemptCount) ?? 0
        lastAttemptAt = try container.decodeIfPresent(Date.self, forKey: .lastAttemptAt)
        errorMessage = try container.decodeIfPresent(String.self, forKey: .errorMessage)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(recordingId, forKey: .recordingId)
        try container.encode(fileURL, forKey: .fileURL)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(durationSeconds, forKey: .durationSeconds)
        try container.encode(attemptCount, forKey: .attemptCount)
        try container.encodeIfPresent(lastAttemptAt, forKey: .lastAttemptAt)
        try container.encodeIfPresent(errorMessage, forKey: .errorMessage)
    }
}

struct DeviceLoginInput {
    let email: String
    let password: String
    let deviceLabel: String
}

enum RecorderPermissionStatus {
    case undetermined
    case granted
    case denied
}

enum TeacherRoute: Equatable {
    case bootstrap
    case standby
    case recording(seconds: Int)
    case analyzing(recordingId: String, message: String)
    case confirm(TeacherRecordingSummary)
    case done(title: String, message: String)
    case pending
}

protocol TeacherTokenStore {
    func loadAuthBundle() -> TeacherAuthBundle?
    func save(authBundle: TeacherAuthBundle) throws
    func clear() throws
}

protocol TeacherAuthRepository {
    func currentSession() async -> TeacherSession?
    func login(input: DeviceLoginInput) async throws -> TeacherSession
    func refreshIfNeeded() async throws -> TeacherSession?
    func forceRefresh() async throws -> TeacherSession?
    func logout() async
}

protocol TeacherRecordingRepository {
    func loadActiveRecording() async throws -> TeacherRecordingSummary?
    func createRecording() async throws -> String
    func uploadAudio(recordingId: String, fileURL: URL, durationSeconds: Double?) async throws -> TeacherRecordingSummary?
    func pollRecording(recordingId: String) async throws -> TeacherRecordingSummary
    func confirmStudent(recordingId: String, studentId: String?) async throws
    func cancelRecording(recordingId: String) async throws
    func retryPendingUploads() async throws
}

protocol PendingUploadStore {
    func loadItems() throws -> [PendingUpload]
    func save(_ item: PendingUpload) throws
    func remove(id: String) throws
}

protocol AudioRecorderClient {
    func permissionStatus() async -> RecorderPermissionStatus
    func requestPermission() async -> RecorderPermissionStatus
    func start() throws
    func stop() throws -> URL
    func cancel() throws
}
