#!/bin/bash
for i in {1..8}
do
	wget http://www.celestegame.com/images/completes/complete-$i.png
	convert complete-$i.png -quality 90 complete-$i.jpg
done