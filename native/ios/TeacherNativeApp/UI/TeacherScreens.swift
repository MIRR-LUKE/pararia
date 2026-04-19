import SwiftUI

struct TeacherAppRootView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator

    var body: some View {
        NavigationStack {
            Group {
                switch coordinator.route {
                case .bootstrap:
                    TeacherBootstrapView(coordinator: coordinator)
                case .standby:
                    TeacherStandbyView(coordinator: coordinator)
                case .recording(let seconds):
                    TeacherRecordingView(coordinator: coordinator, seconds: seconds)
                case .analyzing(_, let message):
                    TeacherAnalyzingView(message: message)
                case .confirm(let summary):
                    TeacherConfirmView(coordinator: coordinator, summary: summary)
                case .done(let title, let message):
                    TeacherDoneView(coordinator: coordinator, title: title, message: message)
                case .pending:
                    TeacherPendingView(coordinator: coordinator)
                }
            }
            .padding(24)
            .background(Color(.systemGroupedBackground))
            .alert("確認", isPresented: Binding(
                get: { coordinator.errorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        coordinator.errorMessage = nil
                    }
                }
            ), actions: {
                Button("閉じる") { coordinator.errorMessage = nil }
            }, message: {
                Text(coordinator.errorMessage ?? "")
            })
            .task {
                if coordinator.session == nil {
                    await coordinator.bootstrap()
                }
            }
        }
    }
}

struct TeacherBootstrapView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator
    @State private var email = ""
    @State private var password = ""
    @State private var deviceLabel = ""

    var body: some View {
        Form {
            Section("端末設定") {
                TextField("メールアドレス", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                SecureField("パスワード", text: $password)
                TextField("端末名", text: $deviceLabel)
            }
            Button("端末を設定する") {
                Task {
                    await coordinator.login(email: email, password: password, deviceLabel: deviceLabel)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .navigationTitle("PARARIA 面談録音")
    }
}

struct TeacherStandbyView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("PARARIA 面談録音")
                .font(.largeTitle.bold())
            if let session = coordinator.session {
                Text("\(session.deviceLabel) / \(session.roleLabel)")
                    .foregroundStyle(.secondary)
            }
            if !coordinator.pendingUploads.isEmpty {
                Text("未送信 \(coordinator.pendingUploads.count) 件")
                    .foregroundStyle(.secondary)
            }
            Button("録音開始") {
                Task { await coordinator.startRecording() }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Button("未送信一覧") {
                coordinator.openPending()
            }
            .buttonStyle(.bordered)

            Button("端末を解除") {
                Task { await coordinator.logout() }
            }
            .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct TeacherRecordingView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator
    let seconds: Int

    var body: some View {
        VStack(spacing: 24) {
            Text("録音中")
                .font(.title.bold())
            Text(String(format: "%02d:%02d", seconds / 60, seconds % 60))
                .font(.system(size: 56, weight: .bold, design: .rounded))
            Button("録音終了") {
                Task { await coordinator.stopRecording() }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            Button("中止") {
                Task { await coordinator.cancelRecording() }
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct TeacherAnalyzingView: View {
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(.circular)
            Text("解析中")
                .font(.title2.bold())
            Text(message)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct TeacherConfirmView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator
    let summary: TeacherRecordingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("この生徒で合っていますか？")
                .font(.title2.bold())
            ForEach(summary.candidates) { candidate in
                Button {
                    Task { await coordinator.confirmStudent(studentId: candidate.id) }
                } label: {
                    VStack(alignment: .leading) {
                        Text(candidate.name).bold()
                        if let subtitle = candidate.subtitle {
                            Text(subtitle).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderedProminent)
            }
            Button("該当なし") {
                Task { await coordinator.confirmStudent(studentId: nil) }
            }
            .buttonStyle(.bordered)
        }
    }
}

struct TeacherDoneView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.title.bold())
            Text(message).foregroundStyle(.secondary)
            Text("まもなく待機画面へ戻ります。")
                .foregroundStyle(.secondary)
            Button("すぐ戻る") {
                coordinator.returnToStandby()
            }
            .buttonStyle(.bordered)
        }
    }
}

struct TeacherPendingView: View {
    @ObservedObject var coordinator: TeacherAppCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("未送信一覧").font(.title2.bold())
            if coordinator.pendingUploads.isEmpty {
                Text("未送信はありません。").foregroundStyle(.secondary)
            } else {
                List(coordinator.pendingUploads) { item in
                    VStack(alignment: .leading) {
                        Text(item.recordingId).bold()
                        Text(item.createdAt.formatted()).foregroundStyle(.secondary)
                        if let errorMessage = item.errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }
                .listStyle(.plain)
            }
            Button("まとめて再送") {
                Task { await coordinator.retryPendingUploads() }
            }
            .buttonStyle(.borderedProminent)
            Button("戻る") {
                coordinator.returnToStandby()
            }
            .buttonStyle(.bordered)
        }
    }
}
