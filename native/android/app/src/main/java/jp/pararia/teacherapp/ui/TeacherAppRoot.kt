package jp.pararia.teacherapp.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.TeacherRecordingSummary
import jp.pararia.teacherapp.domain.TeacherRoute

@Composable
fun TeacherAppRoot(
    viewModel: TeacherAppViewModel
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val microphoneLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = viewModel::onMicrophonePermissionResult,
    )

    LaunchedEffect(uiState.requestMicrophonePermission) {
        if (uiState.requestMicrophonePermission) {
            viewModel.onPermissionRequestHandled()
            microphoneLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    MaterialTheme {
        Surface {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background)
            ) {
                when (val route = uiState.route) {
                    TeacherRoute.Bootstrap -> TeacherBootstrapScreen(
                        onLogin = viewModel::login
                    )
                    TeacherRoute.Standby -> TeacherStandbyScreen(
                        deviceLabel = uiState.session?.deviceLabel,
                        roleLabel = uiState.session?.roleLabel,
                        pendingCount = uiState.pendingUploads.size,
                        onStartRecording = viewModel::startRecording,
                        onOpenPending = viewModel::openPendingUploads,
                        onLogout = viewModel::logout,
                    )
                    is TeacherRoute.Recording -> TeacherRecordingScreen(
                        seconds = route.seconds,
                        onStop = viewModel::stopRecording,
                        onCancel = viewModel::cancelRecording,
                    )
                    is TeacherRoute.Analyzing -> TeacherAnalyzingScreen(message = route.message)
                    is TeacherRoute.Confirm -> TeacherConfirmScreen(
                        summary = route.summary,
                        onConfirm = viewModel::confirmStudent,
                    )
                    is TeacherRoute.Done -> TeacherDoneScreen(
                        title = route.title,
                        message = route.message,
                        onReturn = viewModel::returnToStandby,
                    )
                    TeacherRoute.Pending -> TeacherPendingUploadsScreen(
                        items = uiState.pendingUploads,
                        onRetry = viewModel::retryPendingUploads,
                        onBack = viewModel::returnToStandby,
                    )
                }

                if (uiState.errorMessage != null) {
                    AlertDialog(
                        onDismissRequest = viewModel::dismissError,
                        confirmButton = {
                            Button(onClick = viewModel::dismissError) {
                                Text("閉じる")
                            }
                        },
                        title = { Text("確認") },
                        text = { Text(uiState.errorMessage ?: "") },
                    )
                }
            }
        }
    }
}

@Composable
private fun TeacherBootstrapScreen(
    onLogin: (String, String, String) -> Unit
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var deviceLabel by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("PARARIA 面談録音", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("校舎共通端末として使うための初期設定です。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("メールアドレス") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("パスワード") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
        OutlinedTextField(
            value = deviceLabel,
            onValueChange = { deviceLabel = it },
            label = { Text("端末名") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Button(
            onClick = { onLogin(email, password, deviceLabel) },
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            Text("端末を設定する")
        }
    }
}

@Composable
private fun TeacherStandbyScreen(
    deviceLabel: String?,
    roleLabel: String?,
    pendingCount: Int,
    onStartRecording: () -> Unit,
    onOpenPending: () -> Unit,
    onLogout: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("PARARIA 面談録音", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        if (deviceLabel != null && roleLabel != null) {
            Text("$deviceLabel / $roleLabel", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (pendingCount > 0) {
            Text("未送信 $pendingCount 件", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Button(
            onClick = onStartRecording,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 22.dp),
        ) {
            Text("録音開始")
        }
        OutlinedButton(
            onClick = onOpenPending,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("未送信一覧")
        }
        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("端末を解除")
        }
    }
}

@Composable
private fun TeacherRecordingScreen(
    seconds: Int,
    onStop: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
    ) {
        Text("録音中", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            text = "%02d:%02d".format(seconds / 60, seconds % 60),
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
        )
        Button(
            onClick = onStop,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 22.dp),
        ) {
            Text("録音終了")
        }
        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("中止")
        }
    }
}

@Composable
private fun TeacherAnalyzingScreen(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        CircularProgressIndicator()
        Text("解析中", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TeacherConfirmScreen(
    summary: TeacherRecordingSummary,
    onConfirm: (String?) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("この生徒で合っていますか？", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        summary.candidates.forEach { candidate ->
            Button(
                onClick = { onConfirm(candidate.id) },
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(vertical = 18.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(candidate.name, fontWeight = FontWeight.Bold)
                    if (!candidate.subtitle.isNullOrBlank()) {
                        Text(candidate.subtitle, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.9f))
                    }
                }
            }
        }
        OutlinedButton(
            onClick = { onConfirm(null) },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("該当なし")
        }
    }
}

@Composable
private fun TeacherDoneScreen(
    title: String,
    message: String,
    onReturn: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("まもなく待機画面へ戻ります。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = onReturn) {
            Text("すぐ戻る")
        }
    }
}

@Composable
private fun TeacherPendingUploadsScreen(
    items: List<PendingUpload>,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("未送信一覧", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (items.isEmpty()) {
            Text("未送信はありません。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f, fill = false),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(items) { item ->
                    PendingUploadCard(item)
                }
            }
        }
        Button(
            onClick = onRetry,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("まとめて再送")
        }
        OutlinedButton(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("戻る")
        }
    }
}

@Composable
private fun PendingUploadCard(item: PendingUpload) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(item.recordingId, fontWeight = FontWeight.Bold)
        Text(item.createdAt, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!item.errorMessage.isNullOrBlank()) {
            Text(item.errorMessage, color = MaterialTheme.colorScheme.error)
        }
    }
}
