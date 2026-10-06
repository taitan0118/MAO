; MSAO: mo tuong lua khi cai (mang Private/Domain), xoa khi go. Du lieu o Documents\MSAO khong bi xoa.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MSAO"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MSAO" dir=in action=allow program="$INSTDIR\MSAO.exe" enable=yes profile=private,domain'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MSAO"'
!macroend
