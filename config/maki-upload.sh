filename=$1
if [[ -z "$filename" ]]; then
	cd ~/Pictures/Screenshots
	filename=$(ls -t ~/Pictures/Screenshots | head -n1)
fi

echo "Uploading: $filename"

url=$(curl -s -F token="" -F files="@$filename" \
https://makidoll.io/u/api/upload | jq -r .[0])

echo $url

if env | grep -q ^COPY_TO_CLIPBOARD=; then
	was_disturb=$(dconf read "/org/gnome/desktop/notifications/show-banners")
	if [[ $was_disturb == false ]]; then
		dconf write "/org/gnome/desktop/notifications/show-banners" true
	fi

	if [[ -z "$url" ]]; then
		notify-send -i dialog-information -a "Maki Upload" \
		"Upload failed" "No idea why"
	else
		# xdg-open $url
		echo $url | xclip -selection clipboard
		notify-send -i dialog-information -a "Maki Upload" \
		"Upload successful, copied to clipboard" "$url"
	fi

	if [[ $was_disturb == false ]]; then
		sleep 0.5
		dconf write "/org/gnome/desktop/notifications/show-banners" false
	fi
fi