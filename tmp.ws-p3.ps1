$uri = [Uri]'ws://localhost:64537/parties/main/1'
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync($uri, $ct).GetAwaiter().GetResult()
function Send-Json([System.Net.WebSockets.ClientWebSocket]$socket, [hashtable]$obj) {
  $json = ($obj | ConvertTo-Json -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [System.ArraySegment[byte]]::new($bytes)
  $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult()
}
Send-Json $ws @{ type = 'join_room'; nickname = 'P3' }
Start-Sleep -Milliseconds 600
Send-Json $ws @{ type = 'seat_me' }
Start-Sleep -Seconds 1800
