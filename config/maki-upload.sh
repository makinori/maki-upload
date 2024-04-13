token=""
api_url="https://[siteDomain]/u/api/upload"

filename=$1
if [[ -z "$filename" ]]; then
	cd ~/Pictures/Screenshots
	filename=$(ls -t ~/Pictures/Screenshots | head -n1)
fi

echo "Uploading: $filename"

url=$(curl -s -F token="$token" -F files="@$filename" $api_url | jq -r .[0])

echo $url | xclip -selection clipboard
echo "Copied: $url"

if env | grep -q ^SHOW_DIALOG=; then
	if [[ -z "$url" ]]; then
		kdialog --msgbox "Upload failed"
	else
		kdialog --msgbox "Copied: $url"
	fi
fi