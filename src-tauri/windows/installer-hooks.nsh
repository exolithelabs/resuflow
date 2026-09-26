!include "LogicLib.nsh"
!include "StrFunc.nsh"
!include "WinMessages.nsh"

${StrStr}
${StrRep}
${UnStrRep}

; Make resuflow.exe available as `resuflow` in newly opened shells.
; This is a current-user installer, so no administrator privileges are required.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  StrCpy $2 ";$INSTDIR;"
  ${StrStr} $3 "$1" "$2"

  ${If} $3 == ""
    ${If} $0 == ""
      StrCpy $0 "$INSTDIR"
    ${Else}
      StrCpy $1 $0 1 -1
      ${If} $1 == ";"
        StrCpy $0 "$0$INSTDIR"
      ${Else}
        StrCpy $0 "$0;$INSTDIR"
      ${EndIf}
    ${EndIf}

    WriteRegExpandStr HKCU "Environment" "Path" "$0"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend

; Remove only the exact install directory that this installer added.
!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  ${UnStrRep} $1 "$1" ";$INSTDIR;" ";"
  StrCpy $1 $1 "" 1

  StrCpy $2 $1 1 -1
  ${If} $2 == ";"
    StrCpy $1 $1 -1
  ${EndIf}

  WriteRegExpandStr HKCU "Environment" "Path" "$1"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
