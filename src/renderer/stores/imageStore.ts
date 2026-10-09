import { create } from 'zustand'
import { ImageInfo } from '../../shared/types'
import { resetsWithServer } from '../lib/serverScope'

interface ImageState {
  images: ImageInfo[]
  loading: boolean
  setImages: (images: ImageInfo[]) => void
  setLoading: (loading: boolean) => void
}

export const useImageStore = create<ImageState>((set) => ({
  images: [],
  loading: false,

  setImages: (images) => set({ images }),
  setLoading: (loading) => set({ loading }),
}))

resetsWithServer(useImageStore)
