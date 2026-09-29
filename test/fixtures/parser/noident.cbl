       special-names.
           crt status is key-status.
       data division.
       working-storage section.
       01  key-status.
           03  key-type             pic x.
           03  key-code-1           pic 9(2) comp-x.
           03  key-code-2           pic 9(2) comp-x.
       01  ws-count                 pic 9(4) value zero.
       procedure division.
       main-para.
           add 1 to ws-count
           call "CBL_GET_KBD_STATUS" using key-type
           stop run.
