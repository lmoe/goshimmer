This is a patched version of GoShimmer to enable a more comfy testnet for Wasp.

Currently GoShimmer saves tips inside the memory. If all nodes are getting shut down, it doesn't recover the state. This is especially problematic as the testnet only has one node to begin with. For the testnet it is expected to be able to stop and start the node whenever wanted.

This version walks through the Tangle and recovers the tips after each restart. This can take a while depending on the size of the Tangle, but shouldn't take too much.

This implementation is not optimal or performant. Therefore it's not implemented inside GoShimmer itself.

Furthermore, the `maxParentsTimeDifference` was set to `999999 * time.Hour` to allow transactions that come in highly delayed, or after a longer down time of the node.

This is a pure testing environment and not suitable for production use.

A docker image based on this repository is to be found here:

https://hub.docker.com/r/lukasmoe/goshimmer/tags (wasp-testnet-additions-0-7-5)

You most likely want to visit the real GoShimmer repository too:

https://github.com/iotaledger/goshimmer
