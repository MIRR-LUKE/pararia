package jp.pararia.teacherapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import jp.pararia.teacherapp.ui.TeacherAppRoot
import jp.pararia.teacherapp.ui.TeacherAppViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as TeacherApplication

        setContent {
            val viewModel: TeacherAppViewModel = viewModel(
                factory = TeacherAppViewModel.factory(app.container)
            )
            TeacherAppRoot(viewModel = viewModel)
        }
    }
}
