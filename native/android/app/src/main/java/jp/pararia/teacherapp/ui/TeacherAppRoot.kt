package jp.pararia.teacherapp.ui

import android.Manifest
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import jp.pararia.teacherapp.domain.PendingUpload
import jp.pararia.teacherapp.domain.TeacherRecordingSummary
import jp.pararia.teacherapp.domain.TeacherRoute
import jp.pararia.teacherapp.domain.TeacherStudentCandidate
import java.io.File
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin

private enum class TeacherRouteSurface {
    Bootstrap,
    Standby,
    Recording,
    Analyzing,
    Confirm,
    ManualStudentSelect,
    Done,
    Pending,
}

private val TeacherBlack = Color(0xFF060606)
private val TeacherInk = Color(0xFFF4F4EF)
private val TeacherInkMuted = Color(0xFFB5B5AE)
private val TeacherPanel = Color(0xFF101010)
private val TeacherPanelRaised = Color(0xFF171717)
private val TeacherStroke = Color(0xFF2C2C28)
private val TeacherSoftWhite = Color(0xFFE8E8E2)
private val TeacherError = Color(0xFFF0A0A0)

private val TeacherColorScheme = darkColorScheme(
    background = TeacherBlack,
    surface = TeacherPanel,
    surfaceVariant = TeacherPanelRaised,
    primary = TeacherInk,
    onPrimary = TeacherBlack,
    onSurface = TeacherInk,
    onSurfaceVariant = TeacherInkMuted,
    outline = TeacherStroke,
    error = TeacherError,
)

private val TeacherTypography = Typography(
    displayLarge = TextStyle(
        fontSize = 52.sp,
        lineHeight = 56.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-1.8).sp,
    ),
    displayMedium = TextStyle(
        fontSize = 40.sp,
        lineHeight = 44.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-1.2).sp,
    ),
    headlineLarge = TextStyle(
        fontSize = 30.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.8).sp,
    ),
    headlineMedium = TextStyle(
        fontSize = 24.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.4).sp,
    ),
    bodyLarge = TextStyle(
        fontSize = 17.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Medium,
    ),
    bodyMedium = TextStyle(
        fontSize = 15.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Normal,
    ),
    labelLarge = TextStyle(
        fontSize = 14.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
    ),
    labelSmall = TextStyle(
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.1.sp,
    ),
)

private val TeacherShapes = Shapes(
    small = RoundedCornerShape(16.dp),
    medium = RoundedCornerShape(24.dp),
    large = RoundedCornerShape(32.dp),
)

@Composable
fun TeacherAppRoot(
    viewModel: TeacherAppViewModel
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val microphoneLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = viewModel::onMicrophonePermissionResult,
    )
    val audioPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            importSelectedAudio(context, uri)
        }.onSuccess { selected ->
            viewModel.importAudio(
                filePath = selected.filePath,
                durationSeconds = selected.durationSeconds,
            )
        }.onFailure { error ->
            viewModel.reportError(error.message ?: "音声ファイルを読み込めませんでした。")
        }
    }

    LaunchedEffect(uiState.requestMicrophonePermission) {
        if (uiState.requestMicrophonePermission) {
            viewModel.onPermissionRequestHandled()
            microphoneLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    TeacherMinimalTheme {
        val activeSurface =
            uiState.route is TeacherRoute.Recording || uiState.route is TeacherRoute.Analyzing
        val routeSurface = remember(uiState.route) {
            when (uiState.route) {
                TeacherRoute.Bootstrap -> TeacherRouteSurface.Bootstrap
                TeacherRoute.Standby -> TeacherRouteSurface.Standby
                is TeacherRoute.Recording -> TeacherRouteSurface.Recording
                is TeacherRoute.Analyzing -> TeacherRouteSurface.Analyzing
                is TeacherRoute.Confirm -> TeacherRouteSurface.Confirm
                is TeacherRoute.ManualStudentSelect -> TeacherRouteSurface.ManualStudentSelect
                is TeacherRoute.Done -> TeacherRouteSurface.Done
                TeacherRoute.Pending -> TeacherRouteSurface.Pending
            }
        }
        val topColor by androidx.compose.animation.animateColorAsState(
            targetValue = if (activeSurface) Color(0xFF000000) else Color(0xFF090909),
            animationSpec = tween(durationMillis = 500, easing = FastOutSlowInEasing),
            label = "teacher-bg-top",
        )
        val bottomColor by androidx.compose.animation.animateColorAsState(
            targetValue = if (activeSurface) Color(0xFF181818) else Color(0xFF111111),
            animationSpec = tween(durationMillis = 500, easing = FastOutSlowInEasing),
            label = "teacher-bg-bottom",
        )

        Surface(color = TeacherBlack) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(topColor, bottomColor),
                        )
                    )
            ) {
                Crossfade(
                    targetState = routeSurface,
                    animationSpec = tween(durationMillis = 280, easing = FastOutSlowInEasing),
                    label = "teacher-route",
                ) {
                    val route = uiState.route
                    when (route) {
                        TeacherRoute.Bootstrap -> TeacherBootstrapScreen(
                            onLogin = viewModel::login,
                        )

                        TeacherRoute.Standby -> TeacherStandbyScreen(
                            deviceLabel = uiState.session?.deviceLabel,
                            roleLabel = uiState.session?.roleLabel,
                            pendingCount = uiState.pendingUploads.size,
                            onStartRecording = viewModel::startRecording,
                            onUploadAudio = { audioPickerLauncher.launch(arrayOf("audio/*")) },
                            onOpenPending = viewModel::openPendingUploads,
                            onLogout = viewModel::logout,
                        )

                        is TeacherRoute.Recording -> TeacherRecordingScreen(
                            seconds = route.seconds,
                            paused = route.paused,
                            onStop = viewModel::stopRecording,
                            onPauseToggle = {
                                if (route.paused) {
                                    viewModel.resumeRecording()
                                } else {
                                    viewModel.pauseRecording()
                                }
                            },
                            onCancel = viewModel::cancelRecording,
                        )

                        is TeacherRoute.Analyzing -> TeacherAnalyzingScreen(message = route.message)

                        is TeacherRoute.Confirm -> TeacherConfirmScreen(
                            summary = route.summary,
                            onConfirm = viewModel::confirmStudent,
                            onOpenManualSelect = viewModel::openManualStudentSelect,
                        )

                        is TeacherRoute.ManualStudentSelect -> TeacherManualStudentSelectScreen(
                            summary = route.summary,
                            query = route.query,
                            results = route.results,
                            onQueryChange = viewModel::updateManualStudentQuery,
                            onSelectStudent = viewModel::confirmStudent,
                            onBack = viewModel::closeManualStudentSelect,
                        )

                        is TeacherRoute.Done -> TeacherDoneScreen(
                            title = route.title,
                            message = route.message,
                            onReturn = viewModel::returnToStandby,
                        )

                        TeacherRoute.Pending -> TeacherPendingUploadsScreen(
                            items = uiState.pendingUploads,
                            diagnosticReportText = uiState.diagnosticReportText,
                            onRetry = viewModel::retryPendingUploads,
                            onBack = viewModel::returnToStandby,
                        )
                    }
                }

                if (uiState.errorMessage != null) {
                    TeacherErrorDialog(
                        message = uiState.errorMessage ?: "",
                        diagnosticReportText = uiState.diagnosticReportText,
                        onDismiss = viewModel::dismissError,
                    )
                }
            }
        }
    }
}

@Composable
private fun TeacherMinimalTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = TeacherColorScheme,
        typography = TeacherTypography,
        shapes = TeacherShapes,
        content = content,
    )
}

@Composable
private fun TeacherBootstrapScreen(
    onLogin: (String, String, String) -> Unit
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var deviceLabel by rememberSaveable { mutableStateOf("") }
    val canSubmit = email.isNotBlank() && password.isNotBlank() && deviceLabel.isNotBlank()

    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                TeacherWordmark(meta = "Teacher Recorder")
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "校舎共通端末を設定",
                        style = MaterialTheme.typography.displayMedium,
                    )
                    Text(
                        text = "初回設定だけ管理者か室長で通します。その後は録音専用端末として使えます。",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                TeacherField(
                    label = "メールアドレス",
                    value = email,
                    onValueChange = { email = it },
                )
                TeacherField(
                    label = "パスワード",
                    value = password,
                    onValueChange = { password = it },
                    visualTransformation = PasswordVisualTransformation(),
                )
                TeacherField(
                    label = "端末名",
                    value = deviceLabel,
                    onValueChange = { deviceLabel = it },
                )
                TeacherPrimaryButton(
                    text = "端末を設定する",
                    enabled = canSubmit,
                    onClick = { onLogin(email.trim(), password, deviceLabel.trim()) },
                )
            }

            Text(
                text = "管理者または室長のみ初回設定できます。",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TeacherStandbyScreen(
    deviceLabel: String?,
    roleLabel: String?,
    pendingCount: Int,
    onStartRecording: () -> Unit,
    onUploadAudio: () -> Unit,
    onOpenPending: () -> Unit,
    onLogout: () -> Unit,
) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                TeacherWordmark(meta = "Ready")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TeacherMetaPill(text = deviceLabel ?: "共通端末")
                    if (!roleLabel.isNullOrBlank()) {
                        TeacherMetaPill(text = roleLabel)
                    }
                    if (pendingCount > 0) {
                        TeacherMetaPill(text = "未送信 $pendingCount")
                    }
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                TeacherWaveform(
                    animated = false,
                    modifier = Modifier.fillMaxWidth(),
                    alpha = 0.82f,
                )
                Text(
                    text = "録音開始",
                    style = MaterialTheme.typography.displayLarge,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = "面談が始まったら、下の1ボタンだけで収録します。",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                TeacherCaptureButton(
                    recording = false,
                    onClick = onStartRecording,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TeacherGhostButton(
                    text = "音声アップロード",
                    onClick = onUploadAudio,
                )
                if (pendingCount > 0) {
                    TeacherGhostButton(
                        text = "未送信を確認",
                        onClick = onOpenPending,
                    )
                }
                TeacherTextAction(
                    text = "端末設定を解除",
                    onClick = onLogout,
                )
            }
        }
    }
}

@Composable
private fun TeacherRecordingScreen(
    seconds: Int,
    paused: Boolean,
    onStop: () -> Unit,
    onPauseToggle: () -> Unit,
    onCancel: () -> Unit,
) {
    var showCancelConfirm by rememberSaveable { mutableStateOf(false) }

    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                TeacherWordmark(meta = "Recording")
                Text(
                    text = if (paused) "一時停止中" else "録音中",
                    style = MaterialTheme.typography.headlineLarge,
                )
            }

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                TeacherWaveform(
                    animated = !paused,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    text = formatDuration(seconds),
                    style = MaterialTheme.typography.displayLarge.copy(
                        fontFamily = FontFamily.Monospace,
                    ),
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = if (paused) {
                        "再開するか、このまま保存して解析へ進めます。"
                    } else {
                        "必要なら一時停止できます。終わったら保存します。"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                TeacherCaptureButton(
                    recording = true,
                    onClick = onStop,
                )
                TeacherGhostButton(
                    text = if (paused) "再開" else "一時停止",
                    onClick = onPauseToggle,
                )
                TeacherTextAction(
                    text = "この録音を中止",
                    onClick = { showCancelConfirm = true },
                )
            }
        }

        if (showCancelConfirm) {
            TeacherChoiceDialog(
                title = "録音を中止しますか？",
                message = "この録音は破棄されます。アップロードもログ生成もしません。",
                confirmText = "中止する",
                dismissText = "戻る",
                onConfirm = {
                    showCancelConfirm = false
                    onCancel()
                },
                onDismiss = { showCancelConfirm = false },
            )
        }
    }
}

@Composable
private fun TeacherAnalyzingScreen(message: String) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            TeacherWordmark(meta = "Runpod STT")

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                TeacherWaveform(
                    animated = true,
                    modifier = Modifier.fillMaxWidth(),
                    alpha = 1f,
                )
                Text(
                    text = "解析中",
                    style = MaterialTheme.typography.displayMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            TeacherMetaBlock(
                title = "いまやっていること",
                body = "文字起こしして、生徒候補を整理しています。候補が出たら先生が選ぶだけです。",
            )
        }
    }
}

@Composable
private fun TeacherConfirmScreen(
    summary: TeacherRecordingSummary,
    onConfirm: (String?) -> Unit,
    onOpenManualSelect: () -> Unit,
) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            TeacherWordmark(meta = "Confirm")
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "この生徒で保存",
                    style = MaterialTheme.typography.displayMedium,
                )
                Text(
                    text = buildConfirmSubtitle(summary),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 12.dp),
            ) {
                items(summary.candidates) { candidate ->
                    TeacherCandidateCard(
                        name = candidate.name,
                        subtitle = candidate.subtitle,
                        reason = candidate.reason,
                        score = candidate.score,
                        onClick = { onConfirm(candidate.id) },
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TeacherGhostButton(
                    text = "該当なし / 手動で選ぶ",
                    onClick = onOpenManualSelect,
                )
                TeacherTextAction(
                    text = "生徒なしで保存",
                    onClick = { onConfirm(null) },
                )
            }
        }
    }
}

@Composable
private fun TeacherManualStudentSelectScreen(
    summary: TeacherRecordingSummary,
    query: String,
    results: List<TeacherStudentCandidate>,
    onQueryChange: (String) -> Unit,
    onSelectStudent: (String?) -> Unit,
    onBack: () -> Unit,
) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            TeacherWordmark(meta = "Manual Select")
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "生徒を検索して保存",
                    style = MaterialTheme.typography.displayMedium,
                )
                Text(
                    text = if (summary.candidates.isEmpty()) {
                        "候補にいない場合は、氏名の一部で絞って最後に先生が選びます。"
                    } else {
                        "自動候補 ${summary.candidates.size} 件にいなければ、氏名の一部で手動検索できます。"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            TeacherField(
                label = "生徒名で検索",
                value = query,
                onValueChange = onQueryChange,
            )

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 12.dp),
            ) {
                if (results.isEmpty()) {
                    item {
                        TeacherMetaBlock(
                            title = "検索結果なし",
                            body = "別の呼び方や苗字だけでも探せます。見つからなければ戻って生徒なし保存もできます。",
                        )
                    }
                } else {
                    items(results) { student ->
                        TeacherCandidateCard(
                            name = student.name,
                            subtitle = student.subtitle,
                            reason = student.reason ?: "検索結果から選択して保存します。",
                            score = null,
                            onClick = { onSelectStudent(student.id) },
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TeacherGhostButton(
                    text = "この録音に戻る",
                    onClick = onBack,
                )
                TeacherTextAction(
                    text = "生徒なしで保存",
                    onClick = { onSelectStudent(null) },
                )
            }
        }
    }
}

@Composable
private fun TeacherDoneScreen(
    title: String,
    message: String,
    onReturn: () -> Unit,
) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            TeacherWordmark(meta = "Saved")

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                TeacherCompletionHalo()
                Text(
                    text = title,
                    style = MaterialTheme.typography.displayMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "まもなく待機画面へ戻ります。",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TeacherGhostButton(
                    text = "いま戻る",
                    onClick = onReturn,
                )
            }
        }
    }
}

@Composable
private fun TeacherPendingUploadsScreen(
    items: List<PendingUpload>,
    diagnosticReportText: String,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    TeacherScreenFrame {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            TeacherWordmark(meta = "Pending")
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "未送信一覧",
                    style = MaterialTheme.typography.displayMedium,
                )
                Text(
                    text = if (items.isEmpty()) {
                        "端末内に未送信はありません。"
                    } else {
                        "収録済みの音声をまとめて再送できます。"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (items.isEmpty()) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .clip(MaterialTheme.shapes.large)
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.72f))
                        .border(
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            shape = MaterialTheme.shapes.large,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "未送信はありません。",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(items) { item ->
                        PendingUploadCard(item = item)
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TeacherDiagnosticReportBlock(reportText = diagnosticReportText)
                TeacherPrimaryButton(
                    text = "まとめて再送",
                    enabled = items.isNotEmpty(),
                    onClick = onRetry,
                )
                TeacherGhostButton(
                    text = "戻る",
                    onClick = onBack,
                )
            }
        }
    }
}

@Composable
private fun TeacherScreenFrame(
    content: @Composable BoxScope.() -> Unit
) {
    val density = LocalDensity.current
    val topInset = with(density) { WindowInsets.safeDrawing.getTop(this).toDp() }
    val bottomInset = with(density) { WindowInsets.safeDrawing.getBottom(this).toDp() }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(
                start = 24.dp,
                end = 24.dp,
                top = topInset + 14.dp,
                bottom = bottomInset + 14.dp,
            ),
        content = content,
    )
}

@Composable
private fun TeacherWordmark(meta: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = "PARARIA",
            style = MaterialTheme.typography.headlineLarge.copy(
                fontWeight = FontWeight.Black,
                letterSpacing = (-1.4).sp,
            ),
        )
        Text(
            text = meta.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TeacherField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val interaction = remember { MutableInteractionSource() }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface,
        ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
        interactionSource = interaction,
        visualTransformation = visualTransformation,
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { innerTextField ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(MaterialTheme.shapes.medium)
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.84f))
                        .border(
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            shape = MaterialTheme.shapes.medium,
                        )
                        .padding(horizontal = 18.dp, vertical = 17.dp),
                ) {
                    if (value.isBlank()) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.62f),
                        )
                    }
                    innerTextField()
                }
            }
        },
    )
}

@Composable
private fun TeacherPrimaryButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp),
        shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.28f),
            disabledContentColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.65f),
        ),
        contentPadding = PaddingValues(vertical = 18.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
        )
    }
}

@Composable
private fun TeacherGhostButton(
    text: String,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp),
        shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        contentPadding = PaddingValues(vertical = 16.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
        )
    }
}

@Composable
private fun TeacherTextAction(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun TeacherCaptureButton(
    recording: Boolean,
    onClick: () -> Unit,
) {
    val transition = rememberInfiniteTransition(label = "teacher-capture")
    val pulse by transition.animateFloat(
        initialValue = 0.96f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = if (recording) 940 else 1800,
                easing = FastOutSlowInEasing,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "teacher-capture-pulse",
    )
    val buttonScale by animateFloatAsState(
        targetValue = if (recording) 1.02f else 1f,
        animationSpec = spring(dampingRatio = 0.72f, stiffness = 320f),
        label = "teacher-capture-scale",
    )
    val auraAlpha by animateFloatAsState(
        targetValue = if (recording) 0.3f else 0.14f,
        animationSpec = tween(durationMillis = 320),
        label = "teacher-capture-aura",
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(182.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(172.dp)
                    .graphicsLayer {
                        scaleX = pulse
                        scaleY = pulse
                        alpha = auraAlpha
                    }
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f))
            )
            Box(
                modifier = Modifier
                    .size(152.dp)
                    .clip(CircleShape)
                    .background(Color.Transparent)
                    .border(
                        border = BorderStroke(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.34f),
                        ),
                        shape = CircleShape,
                    )
                    .padding(14.dp)
            ) {
                Button(
                    onClick = onClick,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = buttonScale
                            scaleY = buttonScale
                        },
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = TeacherSoftWhite,
                        contentColor = TeacherBlack,
                    ),
                    contentPadding = PaddingValues(0.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(if (recording) 34.dp else 42.dp)
                            .clip(if (recording) RoundedCornerShape(10.dp) else CircleShape)
                            .background(TeacherBlack)
                    )
                }
            }
        }

        Text(
            text = if (recording) "停止" else "収録を始める",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun TeacherWaveform(
    animated: Boolean,
    modifier: Modifier = Modifier,
    alpha: Float = 1f,
) {
    val transition = rememberInfiniteTransition(label = "teacher-waveform")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = (Math.PI * 2).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "teacher-waveform-phase",
    )

    Row(
        modifier = modifier
            .alpha(alpha)
            .height(84.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        repeat(16) { index ->
            val staticHeight = 0.24f + ((index % 5) * 0.12f)
            val dynamicHeight = 0.28f + abs(sin(phase + (index * 0.42f))) * 0.72f
            val heightRatio = if (animated) dynamicHeight else staticHeight
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height((22f + (heightRatio * 56f)).dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(
                        if (index % 4 == 0) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                        }
                    )
            )
        }
    }
}

@Composable
private fun TeacherMetaPill(text: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.82f))
            .border(
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shape = RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TeacherMetaBlock(
    title: String,
    body: String,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.82f))
            .border(
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shape = MaterialTheme.shapes.large,
            )
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun TeacherCandidateCard(
    name: String,
    subtitle: String?,
    reason: String?,
    score: Double?,
    onClick: () -> Unit,
) {
    val scoreText = score?.let { "一致度 ${(it * 100).roundToInt()}%" }
    val details = listOfNotNull(subtitle?.takeIf { it.isNotBlank() }, reason?.takeIf { it.isNotBlank() })
        .joinToString(" / ")

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.9f))
            .border(
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shape = MaterialTheme.shapes.large,
            )
            .clickable(onClick = onClick)
            .animateContentSize()
            .padding(horizontal = 18.dp, vertical = 18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (scoreText != null) {
                    TeacherMetaPill(text = scoreText)
                }
            }
            if (details.isNotBlank()) {
                Text(
                    text = details,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = "この生徒で保存",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun PendingUploadCard(item: PendingUpload) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.9f))
            .border(
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shape = MaterialTheme.shapes.large,
            )
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = item.recordingId,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
        )
        Text(
            text = item.createdAt,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (item.durationSeconds != null) {
            Text(
                text = "収録 ${formatDuration(item.durationSeconds.roundToInt())}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = "attempt ${item.attemptCount}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!item.errorMessage.isNullOrBlank()) {
            Text(
                text = item.errorMessage,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun TeacherCompletionHalo() {
    val transition = rememberInfiniteTransition(label = "teacher-done")
    val pulse by transition.animateFloat(
        initialValue = 0.94f,
        targetValue = 1.04f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "teacher-done-pulse",
    )
    Box(
        modifier = Modifier.size(142.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(130.dp)
                .graphicsLayer {
                    scaleX = pulse
                    scaleY = pulse
                }
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
        )
        Box(
            modifier = Modifier
                .size(92.dp)
                .clip(CircleShape)
                .background(TeacherSoftWhite)
                .padding(18.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(TeacherBlack)
            )
        }
    }
}

@Composable
private fun TeacherErrorDialog(
    message: String,
    diagnosticReportText: String,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TeacherPrimaryButton(
                text = "閉じる",
                onClick = onDismiss,
            )
        },
        title = {
            Text(
                text = "確認",
                style = MaterialTheme.typography.headlineMedium,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TeacherDiagnosticReportBlock(reportText = diagnosticReportText)
            }
        },
        shape = MaterialTheme.shapes.large,
        containerColor = MaterialTheme.colorScheme.surface,
    )
}

@Composable
private fun TeacherDiagnosticReportBlock(reportText: String) {
    if (reportText.isBlank()) return

    var expanded by rememberSaveable { mutableStateOf(false) }
    val clipboardManager = LocalClipboardManager.current

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeacherTextAction(
            text = if (expanded) "調査メモを隠す" else "調査メモを表示",
            onClick = { expanded = !expanded },
        )
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = reportText,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TeacherGhostButton(
                    text = "調査メモをコピー",
                    onClick = { clipboardManager.setText(AnnotatedString(reportText)) },
                )
            }
        }
    }
}

@Composable
private fun TeacherChoiceDialog(
    title: String,
    message: String,
    confirmText: String,
    dismissText: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                TeacherGhostButton(
                    text = dismissText,
                    onClick = onDismiss,
                )
                TeacherPrimaryButton(
                    text = confirmText,
                    onClick = onConfirm,
                )
            }
        },
        title = {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineMedium,
            )
        },
        text = {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        shape = MaterialTheme.shapes.large,
        containerColor = MaterialTheme.colorScheme.surface,
    )
}

private fun formatDuration(seconds: Int): String =
    "%02d:%02d".format(seconds / 60, seconds % 60)

private fun buildConfirmSubtitle(summary: TeacherRecordingSummary): String {
    val parts = buildList {
        summary.durationSeconds?.let { duration ->
            add("収録 ${formatDuration(duration.roundToInt())}")
        }
        summary.recordedAt?.takeIf { it.isNotBlank() }?.let { add(it) }
    }
    return if (parts.isEmpty()) {
        "文字起こしから近い候補を並べました。最後に先生が選んで保存します。"
    } else {
        parts.joinToString(" / ")
    }
}

private data class ImportedAudioFile(
    val filePath: String,
    val durationSeconds: Double?,
)

private fun importSelectedAudio(context: Context, uri: Uri): ImportedAudioFile {
    val resolver = context.contentResolver
    val fileName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && cursor.moveToFirst()) cursor.getString(nameIndex) else null
        }
        ?.takeIf { it.isNotBlank() }
        ?: "upload-${UUID.randomUUID()}.m4a"

    val outputDirectory = File(context.filesDir, "imports").apply { mkdirs() }
    val outputFile = File(outputDirectory, fileName)

    resolver.openInputStream(uri)?.use { input ->
        outputFile.outputStream().use { output ->
            input.copyTo(output)
        }
    } ?: throw IllegalStateException("音声ファイルを開けませんでした。")

    val durationSeconds = runCatching {
        MediaMetadataRetriever().use { retriever ->
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()
                ?.div(1000.0)
        }
    }.getOrNull()

    return ImportedAudioFile(
        filePath = outputFile.absolutePath,
        durationSeconds = durationSeconds,
    )
}
