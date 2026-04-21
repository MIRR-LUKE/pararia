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
    var errorMessage: String?
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
