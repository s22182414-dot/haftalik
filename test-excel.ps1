$excel = New-Object -ComObject Excel.Application
if($excel) {
    Write-Host "Excel is installed and COM works!"
    $excel.Quit()
} else {
    Write-Host "Excel is not installed."
}
