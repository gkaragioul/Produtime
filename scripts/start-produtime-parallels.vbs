Option Explicit
' ProduTime launcher for Parallels/Network Shared Folders
' This launcher adds --no-sandbox flag which is REQUIRED for Electron apps
' running from network shares (Parallels C:\Mac\Home\... paths)
' See: https://github.com/electron/electron/issues/27356

Dim shell, fso, exe, desktopPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Try Desktop export first (Parallels shared folder)
desktopPath = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\ProduTime-1.6.9-Portable\ProduTime.exe"
If fso.FileExists(desktopPath) Then
  exe = desktopPath
Else
  ' Fallback to local Documents folder
  exe = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\PT-1.6.9-x64\ProduTime.exe"
End If

If fso.FileExists(exe) Then
  ' 1 = activate/normal window, False = do not wait
  ' --no-sandbox is REQUIRED for running from network/Parallels shared folders
  shell.Run """" & exe & """ --no-sandbox --disable-gpu --disable-gpu-sandbox", 1, False
Else
  shell.Popup "ProduTime.exe not found at:" & vbCrLf & exe, 6, "ProduTime launcher", 48
End If

